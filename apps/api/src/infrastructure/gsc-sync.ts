import type { PrismaClient } from '@prisma/client'

/**
 * Search Console 搜索表现同步。
 *
 * 这是「SEO 全生命周期」闭环的最后一环——此前只提交 sitemap 不回读，
 * 用户看不到内容发布后的真实效果（点击、曝光、排名）。
 *
 * 数据特性决定了实现方式：
 *   - 有 2-3 天延迟，同步「今天」永远拿不到数据
 *   - 历史数据会被 Google 回溯修正，因此必须 upsert 而非 append
 *   - 单次查询最多 25000 行，需要分页
 */

const GSC_API = 'https://www.googleapis.com/webmasters/v3'
const MAX_ROWS_PER_PAGE = 25_000
/** Search Console 数据延迟，同步区间需要回退这么多天 */
export const DATA_LAG_DAYS = 3

export interface GscClient {
  request(params: { url: string; method?: string; data?: unknown }): Promise<{ data: unknown }>
}

export interface SearchRow {
  keys?: string[]
  clicks?: number
  impressions?: number
  ctr?: number
  position?: number
}

export interface SyncResult {
  rows: number
  startDate: string
  endDate: string
  error?: string
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** 计算同步区间：结束日回退 DATA_LAG_DAYS，因为更近的数据 Google 还没算出来 */
export function syncWindow(now: Date, days: number): { start: string; end: string } {
  const end = new Date(now)
  end.setUTCDate(end.getUTCDate() - DATA_LAG_DAYS)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - days + 1)
  return { start: toDateString(start), end: toDateString(end) }
}

/**
 * 拉取一个站点的搜索表现。
 *
 * 维度固定为 date + query + page：这是做关键词榜与落地页分析的最小组合。
 * 更多维度（country/device）会让行数指数增长且很少用到。
 */
export async function fetchSearchAnalytics(params: {
  client: GscClient
  siteUrl: string
  startDate: string
  endDate: string
  maxPages?: number
}): Promise<SearchRow[]> {
  const rows: SearchRow[] = []
  const maxPages = params.maxPages ?? 4

  for (let page = 0; page < maxPages; page++) {
    const res = await params.client.request({
      url: `${GSC_API}/sites/${encodeURIComponent(params.siteUrl)}/searchAnalytics/query`,
      method: 'POST',
      data: {
        startDate: params.startDate,
        endDate: params.endDate,
        dimensions: ['date', 'query', 'page'],
        rowLimit: MAX_ROWS_PER_PAGE,
        startRow: page * MAX_ROWS_PER_PAGE,
      },
    })

    const batch = ((res.data as { rows?: SearchRow[] }).rows ?? []) as SearchRow[]
    rows.push(...batch)
    // 不足一页说明已取完，继续请求只会浪费配额
    if (batch.length < MAX_ROWS_PER_PAGE) break
  }

  return rows
}

/**
 * 同步并入库。
 *
 * 单条失败不应中断整批——Google 偶尔返回异常行（如超长 query），
 * 跳过并计数比整个同步失败更有价值。
 */
export async function syncSite(params: {
  prisma: PrismaClient
  client: GscClient
  siteId: string
  siteUrl: string
  days?: number
  now?: Date
}): Promise<SyncResult> {
  const { prisma, siteId } = params
  const { start, end } = syncWindow(params.now ?? new Date(), params.days ?? 28)

  const job = await prisma.gscSyncJob.create({
    data: { siteId, startDate: new Date(start), endDate: new Date(end), status: 'running' },
  })

  try {
    const rows = await fetchSearchAnalytics({
      client: params.client,
      siteUrl: params.siteUrl,
      startDate: start,
      endDate: end,
    })

    let saved = 0
    for (const r of rows) {
      const [date, query, page] = r.keys ?? []
      if (!date) continue

      const where = {
        siteId,
        date: new Date(date),
        query: query ?? '',
        page: page ?? '',
        country: '',
        device: '',
      }
      const data = {
        clicks: Math.round(r.clicks ?? 0),
        impressions: Math.round(r.impressions ?? 0),
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
      }

      try {
        // upsert 而非 create：Google 会回溯修正历史数据，重复同步应覆盖
        await prisma.searchAnalytics.upsert({
          where: { unique_metric: where },
          update: data,
          create: { ...where, ...data },
        })
        saved++
      } catch {
        // 单行异常（超长字段等）跳过，不中断整批
      }
    }

    await prisma.gscSyncJob.update({
      where: { id: job.id },
      data: { status: 'succeeded', rowsSynced: saved, finishedAt: new Date() },
    })

    return { rows: saved, startDate: start, endDate: end }
  } catch (e) {
    const error = (e as Error).message
    await prisma.gscSyncJob.update({
      where: { id: job.id },
      data: { status: 'failed', error: error.slice(0, 500), finishedAt: new Date() },
    })
    return { rows: 0, startDate: start, endDate: end, error }
  }
}

/**
 * 推导 Search Console 中登记的属性地址。
 *
 * 必须与站点实际对外地址一致，否则 GSC 查不到任何数据且不报错。
 * 已验证的自有域名优先——内容权重积累在客户自己的域名下。
 * 手动同步与自动同步共用此函数，避免两条路径推导出不同地址。
 */
export function gscSiteUrl(site: {
  origin: string
  domain: string | null
  domainVerifiedAt: Date | null
}): string {
  return site.domain && site.domainVerifiedAt
    ? `https://${site.domain}/`
    : `${site.origin.replace(/\/$/, '')}/`
}

/** 判断某站点此刻是否该同步：从未同步过，或距上次成功同步已超过间隔 */
export function shouldSync(params: {
  lastSuccessAt: Date | null
  now: Date
  intervalHours: number
}): boolean {
  if (!params.lastSuccessAt) return true
  const elapsed = params.now.getTime() - params.lastSuccessAt.getTime()
  return elapsed >= params.intervalHours * 60 * 60 * 1000
}

export interface KeywordRow {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/** 关键词排行：按点击降序，用于「哪些词在带来流量」 */
export async function topKeywords(
  prisma: PrismaClient,
  siteId: string,
  opts: { days?: number; limit?: number } = {},
): Promise<KeywordRow[]> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - (opts.days ?? 28))

  const rows = await prisma.searchAnalytics.groupBy({
    by: ['query'],
    where: { siteId, date: { gte: since }, query: { not: '' } },
    _sum: { clicks: true, impressions: true },
    _avg: { position: true },
    orderBy: { _sum: { clicks: 'desc' } },
    take: opts.limit ?? 20,
  })

  return rows.map((r) => {
    const clicks = r._sum.clicks ?? 0
    const impressions = r._sum.impressions ?? 0
    return {
      query: r.query,
      clicks,
      impressions,
      // CTR 需按汇总值重算，直接平均每日 CTR 会失真
      ctr: impressions > 0 ? clicks / impressions : 0,
      position: r._avg.position ?? 0,
    }
  })
}

/** 每日汇总，用于趋势图 */
export async function dailyTotals(
  prisma: PrismaClient,
  siteId: string,
  days = 28,
): Promise<Array<{ date: string; clicks: number; impressions: number; position: number }>> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days)

  const rows = await prisma.searchAnalytics.groupBy({
    by: ['date'],
    where: { siteId, date: { gte: since } },
    _sum: { clicks: true, impressions: true },
    _avg: { position: true },
    orderBy: { date: 'asc' },
  })

  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    clicks: r._sum.clicks ?? 0,
    impressions: r._sum.impressions ?? 0,
    position: Number((r._avg.position ?? 0).toFixed(1)),
  }))
}

/**
 * 自动同步：定期把所有已发布内容的站点的搜索表现拉回来。
 *
 * 手动触发做不到闭环——没人会每天去点一次同步按钮，
 * 面板上的数据就会一直停在客户最后一次手动点击的那天。
 * 只有自动回读，「发布后效果如何」才是持续可见的。
 *
 * 只同步有已发布内容的站点：没发布过任何内容的站点在 GSC 里
 * 必然没有数据，同步只会白白消耗配额。
 */
export async function syncAllSites(params: {
  prisma: PrismaClient
  buildClient: () => Promise<GscClient>
  intervalHours?: number
  days?: number
  now?: Date
}): Promise<{ synced: number; skipped: number; failed: number }> {
  const { prisma } = params
  const now = params.now ?? new Date()
  const intervalHours = params.intervalHours ?? 24
  const result = { synced: 0, skipped: 0, failed: 0 }

  const sites = await prisma.site.findMany({
    where: { archivedAt: null, contents: { some: { status: 'published' } } },
    select: { id: true, origin: true, domain: true, domainVerifiedAt: true },
  })
  if (sites.length === 0) return result

  let client: GscClient
  try {
    client = await params.buildClient()
  } catch {
    // 凭据无效时整轮跳过，等待配置修好后的下一轮
    return { ...result, failed: sites.length }
  }

  for (const site of sites) {
    const last = await prisma.gscSyncJob.findFirst({
      where: { siteId: site.id, status: 'succeeded' },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    })

    if (!shouldSync({ lastSuccessAt: last?.finishedAt ?? null, now, intervalHours })) {
      result.skipped += 1
      continue
    }

    try {
      const r = await syncSite({
        prisma,
        client,
        siteId: site.id,
        siteUrl: gscSiteUrl(site),
        days: params.days ?? 28,
        now,
      })
      // syncSite 内部已把失败写进 job 表，这里只做计数
      if (r.error) result.failed += 1
      else result.synced += 1
    } catch {
      // 单站失败不能影响其他站点
      result.failed += 1
    }
  }

  return result
}

/** 启动周期性搜索表现回读，返回停止函数 */
export function startGscSyncWorker(params: {
  prisma: PrismaClient
  buildClient: () => Promise<GscClient>
  /** 检查间隔：多久醒来看一次哪些站点该同步了 */
  tickMs?: number
  /** 单站同步间隔：GSC 数据按天更新，一天一次足够 */
  intervalHours?: number
}): () => void {
  let running = false

  const tick = async () => {
    if (running) return // 防止上一轮未完成时并发执行
    running = true
    try {
      await syncAllSites({
        prisma: params.prisma,
        buildClient: params.buildClient,
        intervalHours: params.intervalHours ?? 24,
      })
    } catch {
      // 单次失败不应终止 worker
    } finally {
      running = false
    }
  }

  const timer = setInterval(tick, params.tickMs ?? 60 * 60 * 1000)
  timer.unref?.()
  return () => clearInterval(timer)
}
