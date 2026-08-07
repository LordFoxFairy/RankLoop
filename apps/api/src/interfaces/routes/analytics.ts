import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { annotateTrend, periodDelta } from '../../domain/insight/publish-events'
import { listAudit } from '../../infrastructure/audit'
import { dailyTotals, gscSiteUrl, syncSite, topKeywords } from '../../infrastructure/gsc-sync'
import { requireScope } from '../../lib/auth'
import { ApiError } from '../../shared/errors'
import { badRequest } from '../error-mapper'

/**
 * 搜索表现数据接口。
 *
 * 闭环的最后一环：内容发布并提交后，回读 Google 的真实反馈——
 * 哪些词带来点击、排名多少、哪些页面有流量。
 * 没有这一环，「SEO 全生命周期」只到提交为止。
 */

function buildGscClient(credentials: string) {
  return import('google-auth-library').then(({ JWT }) => {
    const creds = JSON.parse(credentials) as { client_email: string; private_key: string }
    return new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    })
  })
}

export async function analyticsRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
): Promise<void> {
  /** 概览：区间总量与环比 */
  app.get<{ Params: { siteId: string }; Querystring: { days?: string } }>(
    '/sites/:siteId/search-performance',
    { preHandler: requireScope('analytics:read') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const site = await prisma.site.findFirst({
        where: { id: req.params.siteId, workspaceId, archivedAt: null },
      })
      if (!site) throw new ApiError(404, 'NOT_FOUND', '站点不存在', {})

      const days = Math.min(Math.max(Number(req.query.days) || 28, 1), 90)
      const since = new Date()
      since.setUTCDate(since.getUTCDate() - days)
      // 环比区间：紧邻的等长上一段
      const prevSince = new Date(since)
      prevSince.setUTCDate(prevSince.getUTCDate() - days)

      const [current, previous, lastSync] = await Promise.all([
        prisma.searchAnalytics.aggregate({
          where: { siteId: site.id, date: { gte: since } },
          _sum: { clicks: true, impressions: true },
          _avg: { position: true },
        }),
        prisma.searchAnalytics.aggregate({
          where: { siteId: site.id, date: { gte: prevSince, lt: since } },
          _sum: { clicks: true, impressions: true },
          _avg: { position: true },
        }),
        prisma.gscSyncJob.findFirst({
          where: { siteId: site.id },
          orderBy: { startedAt: 'desc' },
        }),
      ])

      const clicks = current._sum.clicks ?? 0
      const impressions = current._sum.impressions ?? 0
      const prevClicks = previous._sum.clicks ?? 0

      return reply.send({
        data: {
          period_days: days,
          clicks,
          impressions,
          // CTR 按汇总值计算，直接平均每日 CTR 会失真
          ctr: impressions > 0 ? Number((clicks / impressions).toFixed(4)) : 0,
          position: Number((current._avg.position ?? 0).toFixed(1)),
          change: {
            clicks: clicks - prevClicks,
            clicks_pct:
              prevClicks > 0 ? Number((((clicks - prevClicks) / prevClicks) * 100).toFixed(1)) : null,
          },
          last_sync: lastSync
            ? {
                status: lastSync.status,
                rows: lastSync.rowsSynced,
                at: lastSync.startedAt,
                error: lastSync.error,
              }
            : null,
          // 无数据时如实说明原因，而非显示 0 让人误以为没流量
          note:
            clicks === 0 && impressions === 0
              ? lastSync
                ? 'Search Console 尚无该区间数据。新站点通常需要数周才开始有展现。'
                : '尚未同步过 Search Console 数据，请先调用同步接口。'
              : undefined,
        },
        meta: { request_id: req.id },
      })
    },
  )

  /** 关键词排行 */
  app.get<{ Params: { siteId: string }; Querystring: { days?: string; limit?: string } }>(
    '/sites/:siteId/keywords',
    { preHandler: requireScope('analytics:read') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const site = await prisma.site.findFirst({
        where: { id: req.params.siteId, workspaceId, archivedAt: null },
      })
      if (!site) throw new ApiError(404, 'NOT_FOUND', '站点不存在', {})

      const rows = await topKeywords(prisma, site.id, {
        days: Math.min(Number(req.query.days) || 28, 90),
        limit: Math.min(Number(req.query.limit) || 20, 100),
      })

      return reply.send({
        data: rows.map((r) => ({
          query: r.query,
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: Number(r.ctr.toFixed(4)),
          position: Number(r.position.toFixed(1)),
        })),
        meta: { request_id: req.id, count: rows.length },
      })
    },
  )

  /** 每日趋势 */
  app.get<{ Params: { siteId: string }; Querystring: { days?: string } }>(
    '/sites/:siteId/search-trend',
    { preHandler: requireScope('analytics:read') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const site = await prisma.site.findFirst({
        where: { id: req.params.siteId, workspaceId, archivedAt: null },
      })
      if (!site) throw new ApiError(404, 'NOT_FOUND', '站点不存在', {})

      const days = Math.min(Number(req.query.days) || 28, 90)
      const rows = await dailyTotals(prisma, site.id, days)

      // 叠加发布事件：平台独占发布时间戳，外部工具画不出「这次发布之后曲线怎么走」
      const since = new Date()
      since.setUTCDate(since.getUTCDate() - days)
      const published = await prisma.content.findMany({
        where: { siteId: site.id, status: 'published', publishedAt: { gte: since } },
        // 用 path 而非标题：它同时是 GSC page 维度的取值，能把标注对上流量数据
        select: { path: true, publishedAt: true },
        orderBy: { publishedAt: 'asc' },
      })

      const byDate = new Map<string, { date: string; count: number; titles: string[] }>()
      for (const c of published) {
        if (!c.publishedAt) continue
        const date = c.publishedAt.toISOString().slice(0, 10)
        const e = byDate.get(date) ?? { date, count: 0, titles: [] }
        e.count += 1
        e.titles.push(c.path)
        byDate.set(date, e)
      }

      const trend = annotateTrend(rows, [...byDate.values()])
      return reply.send({
        data: trend,
        meta: {
          request_id: req.id,
          count: trend.length,
          // 环比让用户一眼看出「比上个周期是涨是跌」，而不用自己比对折线
          delta: periodDelta(rows),
        },
      })
    },
  )

  /** 审计日志：谁在什么时候改了什么（规格 §8.2） */
  app.get<{ Querystring: { limit?: string; action?: string } }>(
    '/audit',
    { preHandler: requireScope('sites:read') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const rows = await listAudit(prisma, {
        workspaceId,
        limit: Number(req.query.limit) || 100,
        action: req.query.action,
      })

      return reply.send({
        data: rows.map((r) => ({
          id: r.id,
          action: r.action,
          resource: r.resource,
          resource_id: r.resourceId,
          actor: r.user?.email ?? 'API Key',
          metadata: r.metadata,
          ip: r.ip,
          at: r.createdAt,
        })),
        meta: { request_id: req.id, count: rows.length },
      })
    },
  )

  /**
   * 触发同步。
   *
   * 需要配置 GSC_SERVICE_ACCOUNT，且该服务账号已在 Search Console
   * 被添加为站点用户，否则 Google 会返回 403。
   */
  app.post<{ Params: { siteId: string } }>(
    '/sites/:siteId/search-performance/sync',
    { preHandler: requireScope('analytics:read') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const site = await prisma.site.findFirst({
        where: { id: req.params.siteId, workspaceId, archivedAt: null },
      })
      if (!site) throw new ApiError(404, 'NOT_FOUND', '站点不存在', {})

      const credentials = process.env.GSC_SERVICE_ACCOUNT
      if (!credentials) {
        throw new ApiError(409, 'GSC_NOT_CONFIGURED', '平台尚未配置 Search Console 服务账号', {
          hint: '在环境变量中设置 GSC_SERVICE_ACCOUNT',
        })
      }

      const schema = z.object({ days: z.number().int().min(1).max(90).optional() })
      const parsed = schema.safeParse(req.body ?? {})
      if (!parsed.success) throw badRequest(parsed.error.issues)

      // 用实际生效的对外地址查询，与 Search Console 中登记的属性一致
      const siteUrl = gscSiteUrl(site)

      const client = await buildGscClient(credentials)
      const result = await syncSite({
        prisma,
        client: client as never,
        siteId: site.id,
        siteUrl,
        days: parsed.data.days ?? 28,
      })

      if (result.error) {
        // 如实返回失败原因，不伪装成功（规格 §0 第 10 条）
        return reply.code(502).send({
          error: {
            code: 'GSC_SYNC_FAILED',
            message: 'Search Console 同步失败',
            details: {
              reason: result.error,
              hint: '确认服务账号已在 Search Console 中被添加为该站点的用户',
              site_url: siteUrl,
            },
          },
          meta: { request_id: req.id },
        })
      }

      return reply.send({
        data: {
          rows_synced: result.rows,
          start_date: result.startDate,
          end_date: result.endDate,
          note: 'Search Console 数据有 2-3 天延迟，最近几天的数据不会出现在结果中。',
        },
        meta: { request_id: req.id },
      })
    },
  )
}
