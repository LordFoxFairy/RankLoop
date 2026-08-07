import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { listRules, prioritize, summarizeImpact } from '@rankloop/seo-rules'
import { requireScope } from '../../lib/auth'
import { ApiError } from '../../shared/errors'

/**
 * 内容详情：版本历史、分数变化、逐条问题。
 *
 * 「SEO 全生命周期」要求能回溯——看到内容从多少分改到多少分、
 * 哪几条规则曾经不通过、第三方迭代了几轮。
 */

export async function contentDetailRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
): Promise<void> {
  const weights = Object.fromEntries(listRules().map((r) => [r.code, r.weight]))

  /**
   * 优化建议：按性价比排序，告诉用户「先做哪个」。
   *
   * 一堆问题不等于知道从哪下手——权重说明能加多少分，
   * 但修复成本差异极大，真正有用的是「每分钟能挽回多少分」。
   */
  app.get<{ Params: { contentId: string } }>(
    '/contents/:contentId/recommendations',
    { preHandler: requireScope('contents:read') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const content = await prisma.content.findFirst({
        where: {
          id: req.params.contentId,
          // 平台管理员跨租户查看
          ...(req.user?.isPlatformAdmin ? {} : { site: { workspaceId } }),
        },
        include: {
          currentVersion: { include: { checks: { take: 1, orderBy: { createdAt: 'desc' } } } },
        },
      })
      if (!content) throw new ApiError(404, 'NOT_FOUND', '内容不存在', {})

      const check = content.currentVersion?.checks[0]
      if (!check) {
        return reply.send({
          data: { items: [], impact: null, note: '该内容尚无检测结果' },
          meta: { request_id: req.id },
        })
      }

      const items = prioritize({
        issues: (check.issues ?? []) as never,
        weights,
      })
      const impact = summarizeImpact(check.score, items)

      return reply.send({
        data: {
          items: items.map((i) => ({
            code: i.code,
            severity: i.severity,
            message: i.message,
            evidence: i.evidence,
            recommendation: i.recommendation,
            gain: i.gain,
            minutes: i.minutes,
            effort: i.effort,
            blocking: i.blocking,
          })),
          impact,
        },
        meta: { request_id: req.id, count: items.length },
      })
    },
  )

  /** 版本历史与分数变化曲线 */
  app.get<{ Params: { contentId: string } }>(
    '/contents/:contentId/versions',
    { preHandler: requireScope('contents:read') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const content = await prisma.content.findFirst({
        where: {
          id: req.params.contentId,
          ...(req.user?.isPlatformAdmin ? {} : { site: { workspaceId } }),
        },
        select: { id: true, path: true, currentVersionId: true },
      })
      if (!content) throw new ApiError(404, 'NOT_FOUND', '内容不存在', {})

      const versions = await prisma.contentVersion.findMany({
        where: { contentId: content.id },
        orderBy: { version: 'desc' },
        take: 50,
        select: {
          id: true,
          version: true,
          createdAt: true,
          // 不返回正文：列表场景无需传输大字段
          checks: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              score: true,
              criticalCount: true,
              warningCount: true,
              noticeCount: true,
              rulesVersion: true,
            },
          },
        },
      })

      return reply.send({
        data: versions.map((v) => ({
          id: v.id,
          version: v.version,
          is_current: v.id === content.currentVersionId,
          created_at: v.createdAt,
          score: v.checks[0]?.score ?? null,
          counts: v.checks[0]
            ? {
                critical: v.checks[0].criticalCount,
                warning: v.checks[0].warningCount,
                notice: v.checks[0].noticeCount,
              }
            : null,
          rules_version: v.checks[0]?.rulesVersion ?? null,
        })),
        meta: { request_id: req.id, count: versions.length, path: content.path },
      })
    },
  )

  /** 单个版本详情：正文与完整问题列表 */
  app.get<{ Params: { contentId: string; versionId: string } }>(
    '/contents/:contentId/versions/:versionId',
    { preHandler: requireScope('contents:read') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const version = await prisma.contentVersion.findFirst({
        where: {
          id: req.params.versionId,
          contentId: req.params.contentId,
          content: { site: { workspaceId } },
        },
        include: { checks: { take: 1, orderBy: { createdAt: 'desc' } } },
      })
      if (!version) throw new ApiError(404, 'NOT_FOUND', '版本不存在', {})

      const check = version.checks[0]
      return reply.send({
        data: {
          id: version.id,
          version: version.version,
          body: version.body,
          metadata: version.metadata,
          created_at: version.createdAt,
          check: check
            ? {
                score: check.score,
                counts: {
                  critical: check.criticalCount,
                  warning: check.warningCount,
                  notice: check.noticeCount,
                },
                issues: check.issues,
                skipped_rules: check.skippedRules,
                rules_version: check.rulesVersion,
              }
            : null,
        },
        meta: { request_id: req.id },
      })
    },
  )

  /**
   * 站点收录状态总览。
   *
   * 汇总每条已发布内容的线上地址与 IndexNow 提交情况，
   * 用于判断「发布了但没被收录」的具体是哪些页面。
   */
  app.get<{ Params: { siteId: string } }>(
    '/sites/:siteId/indexing-status',
    { preHandler: requireScope('indexing:read') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const site = await prisma.site.findFirst({
        where: { id: req.params.siteId, workspaceId, archivedAt: null },
      })
      if (!site) throw new ApiError(404, 'NOT_FOUND', '站点不存在', {})

      const contents = await prisma.content.findMany({
        where: { siteId: site.id, status: 'published' },
        select: { id: true, path: true, publishedAt: true, updatedAt: true },
        orderBy: { publishedAt: 'desc' },
        take: 500,
      })

      const submissions = await prisma.indexNowSubmission.findMany({
        where: { siteId: site.id },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { urls: true, status: true, createdAt: true, responseCode: true },
      })

      // 建立 URL → 最近一次提交状态的映射
      const byUrl = new Map<string, { status: string; at: Date; code: number | null }>()
      for (const s of submissions) {
        for (const u of (s.urls ?? []) as string[]) {
          if (!byUrl.has(u)) {
            byUrl.set(u, { status: s.status, at: s.createdAt, code: s.responseCode })
          }
        }
      }

      const origin = site.domain && site.domainVerifiedAt ? `https://${site.domain}` : site.origin

      return reply.send({
        data: contents.map((c) => {
          const url = `${origin}${c.path === '/' ? '/' : `${c.path}/`}`
          const sub = byUrl.get(url) ?? byUrl.get(url.replace(/\/$/, ''))
          return {
            content_id: c.id,
            path: c.path,
            url,
            published_at: c.publishedAt,
            indexnow: sub
              ? { status: sub.status, submitted_at: sub.at, response_code: sub.code }
              : { status: 'not_submitted' },
          }
        }),
        meta: {
          request_id: req.id,
          count: contents.length,
          note: 'IndexNow 覆盖 Bing / Yandex / Seznam / Naver；Google 不支持该协议，其收录情况需在 Search Console 查看。',
        },
      })
    },
  )
}
