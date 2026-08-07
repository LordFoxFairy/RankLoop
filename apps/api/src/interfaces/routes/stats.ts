import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
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
      prisma.contentCheck.findMany({
        where: { version: { content: scope } },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          score: true,
          criticalCount: true,
          warningCount: true,
          noticeCount: true,
          issues: true,
          createdAt: true,
          versionId: true,
        },
      }),
    ])

    // 每个版本只取最新一次检测，避免同一版本多次检测重复计数
    const seen = new Set<string>()
    const current = latest.filter((c) => {
      if (seen.has(c.versionId)) return false
      seen.add(c.versionId)
      return true
    })

    const avgScore =
      current.length > 0
        ? Math.round(current.reduce((sum, c) => sum + c.score, 0) / current.length)
        : null

    // 问题分布：按规则编码聚合，供面板展示「最常见的问题」
    const byRule = new Map<string, { code: string; severity: string; count: number }>()
    for (const check of current) {
      for (const issue of (check.issues ?? []) as Array<{ code: string; severity: string }>) {
        const entry = byRule.get(issue.code) ?? {
          code: issue.code,
          severity: issue.severity,
          count: 0,
        }
        entry.count += 1
        byRule.set(issue.code, entry)
      }
    }

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
        top_issues: [...byRule.values()].sort((a, b) => b.count - a.count).slice(0, 10),
        publishable: current.filter((c) => c.criticalCount === 0).length,
        blocked: current.filter((c) => c.criticalCount > 0).length,
      },
      meta: { request_id: req.id },
    })
  })

  /** 分数趋势：按天聚合，供面板画折线 */
  app.get('/stats/trend', { preHandler: requireScope('contents:read') }, async (req, reply) => {
    const { workspaceId } = req.auth!
    const days = 30
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const checks = await prisma.contentCheck.findMany({
      where: { version: { content: { site: { workspaceId } } }, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { score: true, criticalCount: true, createdAt: true },
    })

    const byDay = new Map<string, { total: number; count: number; critical: number }>()
    for (const c of checks) {
      const day = c.createdAt.toISOString().slice(0, 10)
      const entry = byDay.get(day) ?? { total: 0, count: 0, critical: 0 }
      entry.total += c.score
      entry.count += 1
      entry.critical += c.criticalCount
      byDay.set(day, entry)
    }

    return reply.send({
      data: [...byDay.entries()].map(([date, v]) => ({
        date,
        average_score: Math.round(v.total / v.count),
        checks: v.count,
        critical: v.critical,
      })),
      meta: { request_id: req.id, days },
    })
  })
}
