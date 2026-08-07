import { randomBytes } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireScope } from '../../lib/auth'
import { ApiError } from '../../shared/errors'
import { WEBHOOK_EVENTS } from '../../shared/webhook'
import { badRequest } from '../error-mapper'

/**
 * Webhook 配置。
 *
 * 「持续优化」闭环的推送侧：客户登记自己的回调地址，
 * 平台在内容被拦、发布成功、提交完成时主动通知，
 * 客户据此自动修复并重新提交，形成反馈环。
 */

/**
 * 校验回调地址。
 *
 * 必须挡住指向内网的地址——否则客户（或拿到密钥的人）可以让平台
 * 代为请求内网服务，即 SSRF。平台的出站请求带着平台的网络位置，
 * 这是真实且常被忽视的攻击面。
 */
export function assertSafeWebhookUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ApiError(422, 'INVALID_URL', '回调地址不是合法 URL', { url: raw })
  }

  if (url.protocol !== 'https:') {
    // 明文传输会让签名密钥保护的内容在链路上可见
    throw new ApiError(422, 'INSECURE_URL', '回调地址必须使用 https', { url: raw })
  }

  const host = url.hostname.toLowerCase()

  // 私有网段判断只对 IP 字面量生效——10.acme.com 是正常的公网域名，
  // 用前缀匹配主机名会误伤客户的合法地址
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  const privateIpv4 =
    isIpv4 &&
    (/^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) || // 云元数据服务，能读到实例凭据
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^0\./.test(host))

  const blocked =
    privateIpv4 ||
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')

  if (blocked) {
    throw new ApiError(422, 'PRIVATE_URL', '回调地址不能指向内网或本机', { url: raw })
  }

  return url
}

export async function webhookRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  /** 列出已配置的回调 */
  app.get('/webhooks', { preHandler: requireScope('sites:read') }, async (req, reply) => {
    const { workspaceId } = req.auth!
    const hooks = await prisma.webhook.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, url: true, events: true, enabled: true, createdAt: true },
    })

    // 不返回 secret：创建时给过一次，之后无法再查看
    return reply.send({
      data: hooks.map((h) => ({
        id: h.id,
        url: h.url,
        events: h.events,
        enabled: h.enabled,
        created_at: h.createdAt,
      })),
      meta: { request_id: req.id, count: hooks.length },
    })
  })

  /** 登记回调地址 */
  app.post('/webhooks', { preHandler: requireScope('sites:write') }, async (req, reply) => {
    const { workspaceId } = req.auth!

    const schema = z.object({
      url: z.string().min(1),
      // 不填则订阅全部事件——多数客户想要的就是「都告诉我」
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
      secret: z.string().min(16).max(200).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw badRequest(parsed.error.issues)

    assertSafeWebhookUrl(parsed.data.url)

    const quota = await prisma.workspaceQuota.findUnique({ where: { workspaceId } })
    const max = quota?.maxWebhooks ?? 10
    const count = await prisma.webhook.count({ where: { workspaceId } })
    if (count >= max) {
      throw new ApiError(429, 'WEBHOOK_QUOTA_EXCEEDED', '已达 webhook 数量上限', { max })
    }

    // 客户没给密钥就生成一个，并且只在此刻返回一次
    const secret = parsed.data.secret ?? `whsec_${randomBytes(24).toString('base64url')}`

    const hook = await prisma.webhook.create({
      data: {
        workspaceId,
        url: parsed.data.url,
        secret,
        events: parsed.data.events ?? [...WEBHOOK_EVENTS],
      },
    })

    return reply.code(201).send({
      data: {
        id: hook.id,
        url: hook.url,
        events: hook.events,
        enabled: hook.enabled,
        secret,
        warning: '请立即保存此密钥，它不会再次显示。用它验证 X-RankLoop-Signature。',
        signature_format: 't=<unix秒>,v1=<HMAC-SHA256(secret, `${t}.${body}`) 的十六进制>',
      },
      meta: { request_id: req.id },
    })
  })

  /** 更新回调：改地址、改订阅、启停 */
  app.patch<{ Params: { webhookId: string } }>(
    '/webhooks/:webhookId',
    { preHandler: requireScope('sites:write') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const hook = await prisma.webhook.findFirst({
        where: { id: req.params.webhookId, workspaceId },
      })
      if (!hook) throw new ApiError(404, 'NOT_FOUND', 'webhook 不存在', {})

      const schema = z.object({
        url: z.string().min(1).optional(),
        events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
        enabled: z.boolean().optional(),
      })
      const parsed = schema.safeParse(req.body)
      if (!parsed.success) throw badRequest(parsed.error.issues)

      if (parsed.data.url) assertSafeWebhookUrl(parsed.data.url)

      const updated = await prisma.webhook.update({
        where: { id: hook.id },
        data: {
          ...(parsed.data.url ? { url: parsed.data.url } : {}),
          ...(parsed.data.events ? { events: parsed.data.events } : {}),
          ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
        },
      })

      return reply.send({
        data: {
          id: updated.id,
          url: updated.url,
          events: updated.events,
          enabled: updated.enabled,
        },
        meta: { request_id: req.id },
      })
    },
  )

  /** 删除回调 */
  app.delete<{ Params: { webhookId: string } }>(
    '/webhooks/:webhookId',
    { preHandler: requireScope('sites:write') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const hook = await prisma.webhook.findFirst({
        where: { id: req.params.webhookId, workspaceId },
      })
      if (!hook) throw new ApiError(404, 'NOT_FOUND', 'webhook 不存在', {})

      await prisma.webhook.delete({ where: { id: hook.id } })
      return reply.code(204).send()
    },
  )

  /**
   * 投递记录。
   *
   * 客户排查「为什么没收到通知」时的第一现场：
   * 是没触发、投递失败，还是自己的服务返回了错误码。
   */
  app.get<{ Params: { webhookId: string }; Querystring: { limit?: string } }>(
    '/webhooks/:webhookId/deliveries',
    { preHandler: requireScope('sites:read') },
    async (req, reply) => {
      const { workspaceId } = req.auth!
      const hook = await prisma.webhook.findFirst({
        where: { id: req.params.webhookId, workspaceId },
      })
      if (!hook) throw new ApiError(404, 'NOT_FOUND', 'webhook 不存在', {})

      const rows = await prisma.webhookDelivery.findMany({
        where: { webhookId: hook.id },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(req.query.limit) || 50, 200),
      })

      return reply.send({
        data: rows.map((r) => ({
          id: r.id,
          event: r.event,
          event_id: r.eventId,
          status_code: r.statusCode,
          attempt: r.attempt,
          delivered_at: r.deliveredAt,
          next_retry_at: r.nextRetryAt,
          error: r.error,
          created_at: r.createdAt,
        })),
        meta: { request_id: req.id, count: rows.length },
      })
    },
  )
}
