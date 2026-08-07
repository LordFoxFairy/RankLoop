import type { Content } from '../../domain/content'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ContentService } from '../../application/content-service'
import { SeoGateNotPassed } from '../../domain/content'
import { audit } from '../../infrastructure/audit'
import { enqueueEvent } from '../../infrastructure/webhook-dispatcher'
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

function serializeContent(content: Content, url: string, includeBody = false) {
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
    // 正文按需返回：可达 2MB，列表与提交响应里带上会让每次请求都变重。
    // 控制台预览需要它，因此 GET 详情支持 ?body=1。
    ...(includeBody ? { body: content.currentVersion?.body ?? '' } : {}),
  }
}

export async function contentRoutes(
  app: FastifyInstance,
  service: ContentService,
  siteOrigin: (siteId: string, workspaceId: string) => Promise<string>,
  prisma?: import('@prisma/client').PrismaClient,
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
      if (prisma) {
        audit(prisma, req, {
          action: 'content.created',
          resource: 'content',
          resourceId: content.id,
          metadata: { path: content.path.value, score: content.currentVersion?.check.score },
        })
      }
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
        bypassTenantCheck: req.user?.isPlatformAdmin === true,
      })

      // 列表也要给出线上地址：没有它，控制台无法提供预览入口
      const origin = await siteOrigin(req.params.siteId, auth.workspaceId)

      return reply.send({
        data: rows.map(({ content, score }) => {
          const check = content.currentVersion?.check
          return {
            id: content.id,
            path: content.path.value,
            format: content.format,
            status: content.status,
            score,
            // 是否被发布门槛拦截。不能用分数推断——
            // 57 分可能全是 warning，而 0 分未必有 critical。
            blocked: check ? !check.passesGate : false,
            blocking_count: check ? check.blockingRules.length : 0,
            published_at: content.publishedAt,
            // 未发布的内容线上不存在，给 null 而非拼一个必然 404 的地址
            url: content.status === 'published' && origin
              ? `${origin}${content.path.value}`
              : null,
          }
        }),
        meta: { request_id: req.id, count: rows.length },
      })
    },
  )

  app.get<{ Params: { contentId: string }; Querystring: { body?: string } }>(
    '/contents/:contentId',
    { preHandler: requireScope('contents:read') },
    async (req, reply) => {
      const auth = req.auth!
      const content = await service.get(
        req.params.contentId,
        auth.workspaceId,
        req.user?.isPlatformAdmin === true,
      )
      const origin = await siteOrigin(content.siteId, auth.workspaceId)
      return reply.send({
        data: serializeContent(
          content,
          `${origin}${content.path.value}`,
          req.query.body === '1',
        ),
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

      let content: Awaited<ReturnType<typeof service.publish>>
      try {
        content = await service.publish(req.params.contentId, auth.workspaceId)
      } catch (e) {
        // 被门槛拦截时推送事件——这是「持续优化」闭环的起点：
        // 客户收到通知才知道该修什么，否则只有主动调接口才发现得了。
        if (prisma && e instanceof SeoGateNotPassed) {
          void enqueueEvent(prisma, {
            event: 'content.gate_failed',
            workspaceId: auth.workspaceId,
            data: {
              content_id: req.params.contentId,
              blocking: e.blockingRules,
              score: e.score,
            },
            links: {
              // 轻 payload：详情与修复建议让客户凭密钥来拉，
              // 这样重试时拿到的始终是最新状态
              recommendations: `/api/v1/contents/${req.params.contentId}/recommendations`,
              content: `/api/v1/contents/${req.params.contentId}`,
            },
          }).catch(() => {
            // 推送失败不能改变发布结果，客户仍应收到 422
          })
        }
        throw e
      }

      const origin = await siteOrigin(content.siteId, auth.workspaceId)
      if (prisma) {
        audit(prisma, req, {
          action: 'content.published',
          resource: 'content',
          resourceId: content.id,
          metadata: { path: content.path.value },
        })
        void enqueueEvent(prisma, {
          event: 'content.published',
          workspaceId: auth.workspaceId,
          siteId: content.siteId,
          data: {
            content_id: content.id,
            path: content.path.value,
            score: content.currentVersion?.check.score,
          },
          links: { live_url: `${origin}${content.path.value}` },
        }).catch(() => {})
      }
      return reply.send({
        data: serializeContent(content, `${origin}${content.path.value}`),
        meta: { request_id: req.id },
      })
    },
  )
}
