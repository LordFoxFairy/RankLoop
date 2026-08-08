import type { PrismaClient } from '@prisma/client'
import { listRules } from '@rankloop/seo-rules'
import type { FastifyInstance } from 'fastify'
import { compareSearchPeriods } from '../../domain/insight/search-trend'
import { aggregateTopIssues } from '../../domain/insight/top-issues'
import { requireScope } from '../../lib/auth'

/**
 * 面板统计接口。
 *
 * 所有聚合都限定在调用方的工作区内（规格 §2.2）。
 * 数值来自真实检测结果，不提供任何演示数据（规格 §0 第 7 条）。
 */
export async function statsRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  app.get('/stats/overview', { preHandler: requireScope('contents:read') }, async (req, reply) => {
    const { workspaceId } = req.auth!
    // 平台管理员统计全部租户，用于掌握平台整体状况
    const scope = req.user?.isPlatformAdmin ? {} : { site: { workspaceId } }

    const [total, published, draft, sites, latest] = await Promise.all([
      prisma.content.count({ where: scope }),
      prisma.content.count({ where: { ...scope, status: 'published' } }),
      prisma.content.count({ where: { ...scope, status: 'draft' } }),
      prisma.site.count({
        where: { ...(req.user?.isPlatformAdmin ? {} : { workspaceId }), archivedAt: null },
      }),
      // 只统计每个内容的「当前版本」。按 versionId 去重是不够的——
      // 一个内容修订多次会有多个版本，历史版本全被计入会让
      // 「8 篇内容」却显示「可发布 35 + 阻塞 5」这种自相矛盾的数字。
      prisma.contentCheck.findMany({
        where: { version: { content: scope, currentOf: { isNot: null } } },
        orderBy: { createdAt: 'desc' },
        take: 1000,
        select: {
          score: true,
          criticalCount: true,
          warningCount: true,
          noticeCount: true,
          issues: true,
          createdAt: true,
          versionId: true,
          version: { select: { contentId: true } },
        },
      }),
    ])

    // 每个内容只取当前版本的最新一次检测
    const seen = new Set<string>()
    const current = latest.filter((c) => {
      const key = c.version?.contentId ?? c.versionId
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const avgScore =
      current.length > 0
        ? Math.round(current.reduce((sum, c) => sum + c.score, 0) / current.length)
        : null

    // 问题分布：聚合逻辑在领域层，便于脱离数据库测试排序口径
    const topIssues = aggregateTopIssues({
      checks: current.map((c) => ({
        issues: (c.issues ?? []) as Array<{ code: string; severity: string }>,
      })),
      weights: Object.fromEntries(listRules().map((r) => [r.code, r.weight])),
    })

    return reply.send({
      data: {
        sites,
        contents: { total, published, draft },
        health: {
          average_score: avgScore,
          critical: current.reduce((s, c) => s + c.criticalCount, 0),
          warning: current.reduce((s, c) => s + c.warningCount, 0),
          notice: current.reduce((s, c) => s + c.noticeCount, 0),
        },
        top_issues: topIssues,
        publishable: current.filter((c) => c.criticalCount === 0).length,
        blocked: current.filter((c) => c.criticalCount > 0).length,
        // 分数分布而非仅均值：均分 87 可能是「全部 87」，
        // 也可能是「一半 100 一半 74」——后者才需要行动。
        // Ahrefs 的健康分历史图同样展示分档堆叠而非单一均值。
        distribution: [
          { band: 'excellent', min: 90, label: '优秀', count: current.filter((c) => c.score >= 90).length },
          { band: 'good', min: 70, label: '良好', count: current.filter((c) => c.score >= 70 && c.score < 90).length },
          { band: 'fair', min: 50, label: '一般', count: current.filter((c) => c.score >= 50 && c.score < 70).length },
          { band: 'poor', min: 0, label: '较差', count: current.filter((c) => c.score < 50).length },
        ],
      },
      meta: { request_id: req.id },
    })
  })

  /**
   * 搜索表现汇总：跨全部站点。
   *
   * 总览页此前只讲「发布前」，闭环后半段要切到另一个页面才看得到，
   * 等于把「发布后效果如何」这个最该被关注的问题藏了起来。
   */
  app.get('/stats/search', { preHandler: requireScope('analytics:read') }, async (req, reply) => {
    const { workspaceId } = req.auth!
    const siteScope = req.user?.isPlatformAdmin ? {} : { workspaceId }

    const sites = await prisma.site.findMany({
      where: { ...siteScope, archivedAt: null },
      select: { id: true },
    })
    if (sites.length === 0) {
      return reply.send({ data: null, meta: { request_id: req.id } })
    }

    const siteIds = sites.map((s) => s.id)
    const days = 28
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - days)
    const prevSince = new Date(since)
    prevSince.setUTCDate(prevSince.getUTCDate() - days)

    const [current, previous, lastSync] = await Promise.all([
      prisma.searchAnalytics.aggregate({
        where: { siteId: { in: siteIds }, date: { gte: since } },
        _sum: { clicks: true, impressions: true },
        _avg: { position: true },
      }),
      prisma.searchAnalytics.aggregate({
        where: { siteId: { in: siteIds }, date: { gte: prevSince, lt: since } },
        _sum: { clicks: true, impressions: true },
        // 排名同样要环比：Google 明确建议盯「流量下滑」，
        // 而排名恶化通常早于点击下滑出现，只看点击会晚一步才发现。
        _avg: { position: true },
      }),
      prisma.gscSyncJob.findFirst({
        where: { siteId: { in: siteIds } },
        orderBy: { startedAt: 'desc' },
        select: { status: true, startedAt: true, rowsSynced: true },
      }),
    ])

    // 环比口径（CTR 用百分点、排名方向相反等）住在领域层，由测试钉死
    const comparison = compareSearchPeriods(
      {
        clicks: current._sum.clicks ?? 0,
        impressions: current._sum.impressions ?? 0,
        position: current._avg.position ?? 0,
      },
      {
        clicks: previous._sum.clicks ?? 0,
        impressions: previous._sum.impressions ?? 0,
        position: previous._avg.position ?? 0,
      },
    )

    return reply.send({
      data: {
        period_days: days,
        ...comparison,
        // 有没有同步过，决定前端显示「等待数据」还是「尚未配置」
        synced: Boolean(lastSync),
        last_sync_at: lastSync?.startedAt ?? null,
      },
      meta: { request_id: req.id },
    })
  })

  /**
   * Core Web Vitals：真实用户体验数据，来自 Google CrUX。
   *
   * 这些值平台测不出来——LCP/INP/CLS 要真实浏览器渲染真实页面，
   * 我们只收到一份 HTML。CrUX 汇总真实 Chrome 用户，也是 Google
   * 排名时参考的同一份数据。
   *
   * 三种状态必须能区分，否则面板会撒谎：
   *   未配置 API Key → configured:false
   *   配置了但 Google 样本不足 → has_data:false（新站常态，可能持续数月）
   *   有数据 → has_data:true
   * 把后两者混为一谈，就只能显示一排 0，让人以为性能极差。
   */
  app.get('/stats/vitals', { preHandler: requireScope('analytics:read') }, async (req, reply) => {
    const { workspaceId } = req.auth!
    const siteScope = req.user?.isPlatformAdmin ? {} : { workspaceId }

    const sites = await prisma.site.findMany({
      where: { ...siteScope, archivedAt: null },
      select: { id: true },
    })

    const configured = Boolean(process.env.CRUX_API_KEY)
    if (sites.length === 0) {
      return reply.send({
        data: { configured, synced: false, has_data: false, sites: [] },
        meta: { request_id: req.id },
      })
    }

    // 每站取最近一条（按天写入，取最新即当前状态）
    const rows = await prisma.webVitals.findMany({
      where: { siteId: { in: sites.map((s) => s.id) }, scope: 'origin' },
      orderBy: { date: 'desc' },
      take: 50,
      select: {
        siteId: true,
        date: true,
        hasData: true,
        lcpP75: true,
        inpP75: true,
        clsP75: true,
        lcpGood: true,
        inpGood: true,
        clsGood: true,
        site: { select: { origin: true } },
      },
    })

    const latest = new Map<string, (typeof rows)[number]>()
    for (const r of rows) if (!latest.has(r.siteId)) latest.set(r.siteId, r)
    const list = [...latest.values()]
    const withData = list.filter((r) => r.hasData)

    return reply.send({
      data: {
        configured,
        // 同步过就是 true，哪怕 Google 没数据——这与「没数据」是两回事
        synced: list.length > 0,
        has_data: withData.length > 0,
        checked_at: list[0]?.date ?? null,
        sites: withData.map((r) => ({
          origin: r.site.origin,
          lcp_p75: r.lcpP75,
          inp_p75: r.inpP75,
          cls_p75: r.clsP75,
          lcp_good: r.lcpGood,
          inp_good: r.inpGood,
          cls_good: r.clsGood,
        })),
      },
      meta: { request_id: req.id },
    })
  })

  /**
   * 分数趋势：按天聚合，供面板画折线。
   *
   * 每天取「该内容当天最后一次检测」再求均值，而非把当天所有检测
   * 一起平均——同一篇内容修了五次会被计五次，让曲线反映的是
   * 修改频率而不是质量。这也让趋势与总览的口径一致。
   */
  app.get<{ Querystring: { days?: string } }>(
    '/stats/trend',
    { preHandler: requireScope('contents:read') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 90)
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      const scope = req.user?.isPlatformAdmin ? {} : { site: { workspaceId } }

      const checks = await prisma.contentCheck.findMany({
        where: { version: { content: scope }, createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
        select: {
          score: true,
          criticalCount: true,
          createdAt: true,
          version: { select: { contentId: true } },
        },
      })

      // 每天取「所有内容截至当天的最新分数」求均值，而不是只算当天动过的。
      // 只算当天动过的会让曲线反映「今天碰了哪些内容」而非站点整体质量——
      // 8 篇里只重发 1 篇 82 分，当天均分就会掉成 82，与总览的 98 自相矛盾。
      const latest = new Map<string, { score: number; critical: number }>()
      const byDay = new Map<string, { total: number; count: number; critical: number }>()

      // checks 已按 createdAt 升序，逐日推进即可维护「截至当天」的快照
      const days_ = [...new Set(checks.map((c) => c.createdAt.toISOString().slice(0, 10)))].sort()
      let i = 0
      for (const day of days_) {
        while (i < checks.length && checks[i].createdAt.toISOString().slice(0, 10) <= day) {
          const c = checks[i]
          latest.set(c.version.contentId, { score: c.score, critical: c.criticalCount })
          i++
        }
        let total = 0
        let critical = 0
        for (const v of latest.values()) {
          total += v.score
          critical += v.critical
        }
        byDay.set(day, { total, count: latest.size, critical })
      }

      return reply.send({
        data: [...byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, v]) => ({
            date,
            average_score: Math.round(v.total / v.count),
            // 语义是「当天有多少篇内容」，不是「跑了多少次检测」
            contents: v.count,
            critical: v.critical,
          })),
        meta: { request_id: req.id, days },
      })
    },
  )
}
