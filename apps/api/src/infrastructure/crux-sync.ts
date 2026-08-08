import type { PrismaClient } from '@prisma/client'
import { CruxQuotaExceeded, fetchCrux } from './crux'

/**
 * 每日回读各站点的 Core Web Vitals。
 *
 * 与 GSC 同步同构：一天一次即可——CrUX 数据本身按 28 天滚动窗口聚合，
 * 查得再勤也不会变化，只是白白消耗配额。
 *
 * 只查 origin 粒度，不逐页查。原因是单页要求的样本量远高于整站，
 * 我们的租户站短期内单页几乎必然 404；逐页查等于用几十倍的请求
 * 去换一堆「无数据」。等站点真有流量了再考虑加单页粒度。
 */
export async function syncAllVitals(params: {
  prisma: PrismaClient
  apiKey: string
  intervalHours?: number
  now?: Date
  fetchImpl?: typeof fetch
  onError?: (siteId: string, origin: string, error: string) => void
}): Promise<{ synced: number; noData: number; skipped: number; failed: number }> {
  const { prisma, apiKey } = params
  const now = params.now ?? new Date()
  const intervalHours = params.intervalHours ?? 24
  const result = { synced: 0, noData: 0, skipped: 0, failed: 0 }

  // 只查已发布内容的站点：没上线的站点 CrUX 必然没有数据
  const sites = await prisma.site.findMany({
    where: { archivedAt: null, contents: { some: { status: 'published' } } },
    select: { id: true, origin: true },
  })

  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )

  for (const site of sites) {
    if (!site.origin) {
      result.skipped++
      continue
    }

    // 当天已同步过就跳过，避免重启后重复打配额
    const existing = await prisma.webVitals.findFirst({
      where: { siteId: site.id, scope: 'origin', url: '', formFactor: 'ALL', date: today },
      select: { id: true },
    })
    if (existing) {
      result.skipped++
      continue
    }

    // 上一次同步距今不足间隔也跳过
    if (intervalHours > 0) {
      const cutoff = new Date(now.getTime() - intervalHours * 3600_000)
      const recent = await prisma.webVitals.findFirst({
        where: { siteId: site.id, createdAt: { gte: cutoff } },
        select: { id: true },
      })
      if (recent) {
        result.skipped++
        continue
      }
    }

    try {
      const origin = site.origin.replace(/\/$/, '')
      const data = await fetchCrux({
        apiKey,
        target: origin,
        scope: 'origin',
        fetchImpl: params.fetchImpl,
      })

      // 无数据也要落库：这样面板能区分「没同步过」与
      // 「同步了但 Google 样本不足」，后者要如实说明原因而不是显示 0
      await prisma.webVitals.upsert({
        where: {
          unique_vitals: {
            siteId: site.id,
            scope: 'origin',
            url: '',
            formFactor: 'ALL',
            date: today,
          },
        },
        create: { siteId: site.id, scope: 'origin', url: '', formFactor: 'ALL', date: today, ...data },
        update: { ...data },
      })

      if (data.hasData) result.synced++
      else result.noData++
    } catch (e) {
      // 配额耗尽就停止本轮，继续查只会把剩余配额也打光
      if (e instanceof CruxQuotaExceeded) {
        params.onError?.(site.id, site.origin, 'CrUX 配额已用尽，本轮提前结束')
        break
      }
      result.failed++
      params.onError?.(site.id, site.origin, e instanceof Error ? e.message : String(e))
    }
  }

  return result
}

export function startCruxSyncWorker(params: {
  prisma: PrismaClient
  apiKey: string
  tickMs?: number
  intervalHours?: number
  onError?: (siteId: string, origin: string, error: string) => void
}): () => void {
  let running = false

  const tick = async () => {
    if (running) return
    running = true
    try {
      await syncAllVitals({
        prisma: params.prisma,
        apiKey: params.apiKey,
        intervalHours: params.intervalHours ?? 24,
        onError: params.onError,
      })
    } catch {
      // 单次失败不终止 worker
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => void tick(), params.tickMs ?? 3600_000)
  void tick()
  return () => clearInterval(timer)
}
