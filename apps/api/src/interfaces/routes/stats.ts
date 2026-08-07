import type { PrismaClient } from '@prisma/client'
import { listRules } from '@rankloop/seo-rules'
import type { FastifyInstance } from 'fastify'
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

      // 先按「日期 + 内容」折叠，保留当天最后一次检测
      const perDayContent = new Map<string, { score: number; critical: number }>()
      for (const c of checks) {
        const day = c.createdAt.toISOString().slice(0, 10)
        perDayContent.set(`${day}|${c.version.contentId}`, {
          score: c.score,
          critical: c.criticalCount,
        })
      }

      const byDay = new Map<string, { total: number; count: number; critical: number }>()
      for (const [key, v] of perDayContent) {
        const day = key.split('|')[0]
        const entry = byDay.get(day) ?? { total: 0, count: 0, critical: 0 }
        entry.total += v.score
        entry.count += 1
        entry.critical += v.critical
        byDay.set(day, entry)
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
