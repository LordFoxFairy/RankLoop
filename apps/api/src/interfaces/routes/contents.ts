import type { Content } from '../../domain/content'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ContentService } from '../../application/content-service'
import { requireScope } from '../../lib/auth'
import { badRequest } from '../error-mapper'

/**
 * 接口层：HTTP 适配。
 *
 * 只做三件事：解析参数、调用应用服务、序列化响应。
 * 不含任何业务规则——发布门槛等规则住在领域层聚合根里。
 * 领域异常由 error-mapper 统一转成 HTTP 状态码。
 */

const submitSchema = z.object({
  path: z.string().min(1).max(512),
  format: z.enum(['html', 'markdown']),
  body: z.string().min(1).max(2_000_000),
})

const reviseSchema = z.object({
  format: z.enum(['html', 'markdown']).optional(),
  body: z.string().min(1).max(2_000_000),
})

const checkSchema = z.object({
  format: z.enum(['html', 'markdown']),
  body: z.string().min(1).max(2_000_000),
  url: z.string().url(),
})

function serializeCheck(content: Content) {
  const check = content.currentVersion?.check
  if (!check) return null
  return {
    score: check.score,
    counts: check.counts,
    issues: check.issues,
    skipped_rules: check.skippedRules,
    rules_version: check.rulesVersion,
  }
}

function serializeContent(content: Content, url: string) {
  return {
    id: content.id,
    path: content.path.value,
    format: content.format,
    status: content.status,
    version: content.currentVersion?.version,
    url,
    published_at: content.publishedAt,
    check: serializeCheck(content),
    publishable: content.publishable,
  }
}

export async function contentRoutes(
  app: FastifyInstance,
  service: ContentService,
  siteOrigin: (siteId: string, workspaceId: string) => Promise<string>,
): Promise<void> {
  app.post<{ Params: { siteId: string } }>(
    '/sites/:siteId/contents',
    { preHandler: requireScope('contents:write') },
    async (req, reply) => {
      const auth = req.auth!
      const input = submitSchema.safeParse(req.body)
      if (!input.success) throw badRequest(input.error.issues)

      const content = await service.submit({
        siteId: req.params.siteId,
        workspaceId: auth.workspaceId,
        ...input.data,
      })

      const origin = await siteOrigin(req.params.siteId, auth.workspaceId)
      return reply.code(201).send({
        data: serializeContent(content, `${origin}${content.path.value}`),
        meta: { request_id: req.id },
      })
    },
  )

  app.get<{ Params: { siteId: string }; Querystring: { status?: string; limit?: string } }>(
    '/sites/:siteId/contents',
    { preHandler: requireScope('contents:read') },
    async (req, reply) => {
      const auth = req.auth!
      const rows = await service.list({
        siteId: req.params.siteId,
        workspaceId: auth.workspaceId,
        status: req.query.status,
        limit: Math.min(Number(req.query.limit) || 50, 200),
      })

      return reply.send({
        data: rows.map(({ content, score }) => ({
          id: content.id,
          path: content.path.value,
          format: content.format,
          status: content.status,
          score,
          published_at: content.publishedAt,
        })),
        meta: { request_id: req.id, count: rows.length },
      })
    },
  )

  app.get<{ Params: { contentId: string } }>(
    '/contents/:contentId',
    { preHandler: requireScope('contents:read') },
    async (req, reply) => {
      const auth = req.auth!
      const content = await service.get(req.params.contentId, auth.workspaceId)
      const origin = await siteOrigin(content.siteId, auth.workspaceId)
      return reply.send({
        data: serializeContent(content, `${origin}${content.path.value}`),
        meta: { request_id: req.id },
      })
    },
  )

  app.put<{ Params: { contentId: string } }>(
    '/contents/:contentId',
    { preHandler: requireScope('contents:write') },
    async (req, reply) => {
      const auth = req.auth!
      const input = reviseSchema.safeParse(req.body)
      if (!input.success) throw badRequest(input.error.issues)

      const content = await service.revise({
        contentId: req.params.contentId,
        workspaceId: auth.workspaceId,
        ...input.data,
      })

      const origin = await siteOrigin(content.siteId, auth.workspaceId)
      return reply.send({
        data: serializeContent(content, `${origin}${content.path.value}`),
        meta: { request_id: req.id },
      })
    },
  )

  // 无状态预检：不落库
  app.post('/contents/check', { preHandler: requireScope('contents:write') }, async (req, reply) => {
    const input = checkSchema.safeParse(req.body)
    if (!input.success) throw badRequest(input.error.issues)

    const { check } = service.check(input.data)
    return reply.send({
      data: {
        check: {
          score: check.score,
          counts: check.counts,
          issues: check.issues,
          skipped_rules: check.skippedRules,
          rules_version: check.rulesVersion,
        },
        publishable: check.passesGate,
      },
      meta: { request_id: req.id },
    })
  })

  app.post<{ Params: { contentId: string } }>(
    '/contents/:contentId/publish',
    { preHandler: requireScope('contents:publish') },
    async (req, reply) => {
      const auth = req.auth!
      const content = await service.publish(req.params.contentId, auth.workspaceId)
      const origin = await siteOrigin(content.siteId, auth.workspaceId)
      return reply.send({
        data: serializeContent(content, `${origin}${content.path.value}`),
        meta: { request_id: req.id },
      })
    },
  )
}
