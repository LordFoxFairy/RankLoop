import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireScope, requireSite } from '../lib/auth'
import { errors } from '../lib/errors'
import { checkContent } from '../lib/publish-gate'
import { contentUrl, normalizePath } from '../lib/url'

/**
 * 托管内容 CRUD 与发布（ADR-001）。
 *
 * 闭环：提交 → 检测 → 返回不合格项 → 第三方自行优化 → 更新 → 达标 → 发布。
 * 平台不生成内容，只做判定。
 */

const bodySchema = z.object({
  path: z.string().min(1).max(512),
  format: z.enum(['html', 'markdown']),
  body: z.string().min(1).max(2_000_000),
})

const updateSchema = bodySchema.omit({ path: true }).partial().extend({
  body: z.string().min(1).max(2_000_000),
})

/** 检测结果的统一序列化，提交/更新/查询共用同一形状 */
function serializeCheck(check: ReturnType<typeof checkContent>['check']) {
  return {
    score: check.score,
    counts: check.counts,
    issues: check.issues,
    skipped_rules: check.skippedRules,
    rules_version: check.rulesVersion,
  }
}

export async function contentRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  // 提交内容：立即检测并返回结果，第三方据此决定是否需要继续优化
  app.post<{ Params: { siteId: string } }>(
    '/sites/:siteId/contents',
    { preHandler: requireScope('contents:write') },
    async (req, reply) => {
      const auth = req.auth!
      const site = await requireSite(prisma, req.params.siteId, auth.workspaceId)

      const parsed = bodySchema.safeParse(req.body)
      if (!parsed.success) throw errors.validation({ issues: parsed.error.issues })

      let path: string
      try {
        path = normalizePath(parsed.data.path)
      } catch (e) {
        throw errors.validation({ path: (e as Error).message })
      }

      const existing = await prisma.content.findUnique({
        where: { siteId_path: { siteId: site.id, path } },
      })
      if (existing) {
        throw errors.conflict('CONTENT_EXISTS', '该路径已存在内容，请改用更新接口', {
          content_id: existing.id,
        })
      }

      const quota = await prisma.workspaceQuota.findUnique({
        where: { workspaceId: auth.workspaceId },
      })
      if (quota) {
        const count = await prisma.content.count({ where: { site: { workspaceId: auth.workspaceId } } })
        if (count >= quota.maxContents) throw errors.quotaExceeded('max_contents', quota.maxContents)
      }

      const url = contentUrl(site.origin, path)
      const result = checkContent({ format: parsed.data.format, body: parsed.data.body, url })

      const content = await prisma.content.create({
        data: {
          siteId: site.id,
          path,
          format: parsed.data.format,
          status: 'draft',
          versions: {
            create: {
              version: 1,
              body: parsed.data.body,
              metadata: result.metadata as object,
              checks: { create: buildCheckRow(result) },
            },
          },
        },
        include: { versions: { include: { checks: true } } },
      })

      const version = content.versions[0]
      await prisma.content.update({
        where: { id: content.id },
        data: { currentVersionId: version.id },
      })

      return reply.code(201).send({
        data: {
          id: content.id,
          path: content.path,
          format: content.format,
          status: content.status,
          version: version.version,
          url,
          check: serializeCheck(result.check),
          publishable: result.allowed,
        },
        meta: { request_id: req.id },
      })
    },
  )

  // 更新内容：产生新版本并重新检测，支持第三方反复迭代
  app.put<{ Params: { contentId: string } }>(
    '/contents/:contentId',
    { preHandler: requireScope('contents:write') },
    async (req, reply) => {
      const auth = req.auth!
      const content = await findContent(prisma, req.params.contentId, auth.workspaceId)

      const parsed = updateSchema.safeParse(req.body)
      if (!parsed.success) throw errors.validation({ issues: parsed.error.issues })

      const format = parsed.data.format ?? content.format
      const url = contentUrl(content.site.origin, content.path)
      const result = checkContent({ format, body: parsed.data.body, url })

      const latest = await prisma.contentVersion.findFirst({
        where: { contentId: content.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      })

      const version = await prisma.contentVersion.create({
        data: {
          contentId: content.id,
          version: (latest?.version ?? 0) + 1,
          body: parsed.data.body,
          metadata: result.metadata as object,
          checks: { create: buildCheckRow(result) },
        },
      })

      await prisma.content.update({
        where: { id: content.id },
        data: { currentVersionId: version.id, format },
      })

      return reply.send({
        data: {
          id: content.id,
          path: content.path,
          format,
          status: content.status,
          version: version.version,
          url,
          check: serializeCheck(result.check),
          publishable: result.allowed,
        },
        meta: { request_id: req.id },
      })
    },
  )

  // 无副作用的预检：不落库，供第三方发布前反复试算
  app.post(
    '/contents/check',
    { preHandler: requireScope('contents:write') },
    async (req, reply) => {
      const schema = z.object({
        format: z.enum(['html', 'markdown']),
        body: z.string().min(1).max(2_000_000),
        url: z.string().url(),
      })
      const parsed = schema.safeParse(req.body)
      if (!parsed.success) throw errors.validation({ issues: parsed.error.issues })

      const result = checkContent(parsed.data)
      return reply.send({
        data: { check: serializeCheck(result.check), publishable: result.allowed },
        meta: { request_id: req.id },
      })
    },
  )

  app.get<{ Params: { contentId: string } }>(
    '/contents/:contentId',
    { preHandler: requireScope('contents:read') },
    async (req, reply) => {
      const auth = req.auth!
      const content = await findContent(prisma, req.params.contentId, auth.workspaceId)
      const check = content.currentVersion?.checks[0]

      return reply.send({
        data: {
          id: content.id,
          path: content.path,
          format: content.format,
          status: content.status,
          version: content.currentVersion?.version,
          url: contentUrl(content.site.origin, content.path),
          published_at: content.publishedAt,
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

  app.get<{ Params: { siteId: string }; Querystring: { status?: string; limit?: string } }>(
    '/sites/:siteId/contents',
    { preHandler: requireScope('contents:read') },
    async (req, reply) => {
      const auth = req.auth!
      const site = await requireSite(prisma, req.params.siteId, auth.workspaceId)
      const limit = Math.min(Number(req.query.limit) || 50, 200)

      const status = req.query.status as 'draft' | 'published' | undefined
      const contents = await prisma.content.findMany({
        where: { siteId: site.id, ...(status ? { status } : {}) },
        include: { currentVersion: { include: { checks: { take: 1 } } } },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      })

      return reply.send({
        data: contents.map((c) => ({
          id: c.id,
          path: c.path,
          format: c.format,
          status: c.status,
          score: c.currentVersion?.checks[0]?.score ?? null,
          published_at: c.publishedAt,
        })),
        meta: { request_id: req.id, count: contents.length },
      })
    },
  )

  // 发布：critical 问题存在时拒绝（ADR-001 §4）
  app.post<{ Params: { contentId: string } }>(
    '/contents/:contentId/publish',
    { preHandler: requireScope('contents:publish') },
    async (req, reply) => {
      const auth = req.auth!
      const content = await findContent(prisma, req.params.contentId, auth.workspaceId)

      const version = content.currentVersion
      if (!version) throw errors.notFound('内容版本')

      // 以当前版本重新检测，不依赖历史检测结果——规则可能已更新
      const url = contentUrl(content.site.origin, content.path)
      const result = checkContent({ format: content.format, body: version.body, url })

      if (!result.allowed) {
        throw errors.gateFailed(result.blocking, result.check.score)
      }

      const published = await prisma.content.update({
        where: { id: content.id },
        data: { status: 'published', publishedAt: new Date() },
      })

      return reply.send({
        data: {
          id: published.id,
          status: published.status,
          url,
          published_at: published.publishedAt,
          check: serializeCheck(result.check),
        },
        meta: { request_id: req.id },
      })
    },
  )
}

function buildCheckRow(result: ReturnType<typeof checkContent>) {
  return {
    score: result.check.score,
    criticalCount: result.check.counts.critical,
    warningCount: result.check.counts.warning,
    noticeCount: result.check.counts.notice,
    issues: result.check.issues as unknown as object,
    skippedRules: result.check.skippedRules as unknown as object,
    rulesVersion: result.check.rulesVersion,
  }
}

/** 通过工作区过滤，保证跨租户访问返回 404 */
async function findContent(prisma: PrismaClient, contentId: string, workspaceId: string) {
  const content = await prisma.content.findFirst({
    where: { id: contentId, site: { workspaceId } },
    include: {
      site: true,
      currentVersion: { include: { checks: { take: 1, orderBy: { createdAt: 'desc' } } } },
    },
  })
  if (!content) throw errors.notFound('内容')
  return content
}
