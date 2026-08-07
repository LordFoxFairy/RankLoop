import type { PrismaClient } from '@prisma/client'
import {
  MAX_WEBHOOK_ATTEMPTS,
  type WebhookEvent,
  buildPayload,
  nextRetryDelayMs,
  signPayload,
} from '../shared/webhook'

/**
 * Webhook 投递。
 *
 * 这是「持续优化」闭环的推送侧：平台检测出问题后主动通知客户，
 * 而不是等客户轮询。客户收到 content.gate_failed 就知道该修什么，
 * 修完重新提交，形成反馈环。
 *
 * 投递语义是「至少一次」——网络失败会重试，因此 payload 带 event_id
 * 供接收方去重。宁可重复也不能丢，丢了客户就永远不知道内容被拦了。
 */

const DELIVERY_TIMEOUT_MS = 10_000

export interface DispatchResult {
  delivered: number
  failed: number
  retrying: number
}

/**
 * 为一个事件创建投递记录。
 *
 * 只入库不发送——发送由后台 worker 负责，避免外部 HTTP 阻塞业务请求。
 * 客户的接收端可能很慢甚至挂掉，不能让它拖垮发布接口。
 */
export async function enqueueEvent(
  prisma: PrismaClient,
  params: {
    event: WebhookEvent
    workspaceId: string
    siteId?: string
    data: Record<string, unknown>
    links: Record<string, string>
  },
): Promise<number> {
  const hooks = await prisma.webhook.findMany({
    where: { workspaceId: params.workspaceId, enabled: true, events: { has: params.event } },
    select: { id: true },
  })
  if (hooks.length === 0) return 0

  const payload = buildPayload(params)

  await prisma.webhookDelivery.createMany({
    data: hooks.map((h) => ({
      webhookId: h.id,
      eventId: payload.event_id,
      event: params.event,
      payload: payload as unknown as object,
      attempt: 0,
      // 立即可投递
      nextRetryAt: new Date(),
    })),
  })

  return hooks.length
}

/** 投递所有到期的记录 */
export async function dispatchPending(
  prisma: PrismaClient,
  opts: { now?: Date; limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<DispatchResult> {
  const now = opts.now ?? new Date()
  const doFetch = opts.fetchImpl ?? fetch
  const result: DispatchResult = { delivered: 0, failed: 0, retrying: 0 }

  const pending = await prisma.webhookDelivery.findMany({
    where: {
      deliveredAt: null,
      nextRetryAt: { lte: now },
      attempt: { lt: MAX_WEBHOOK_ATTEMPTS },
    },
    orderBy: { createdAt: 'asc' },
    take: opts.limit ?? 50,
    include: { webhook: true },
  })

  for (const d of pending) {
    // 投递期间 webhook 可能已被停用，此时不该继续打扰客户
    if (!d.webhook || !d.webhook.enabled) {
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { error: 'webhook 已停用', attempt: MAX_WEBHOOK_ATTEMPTS },
      })
      result.failed += 1
      continue
    }

    const body = JSON.stringify(d.payload)
    const timestamp = Math.floor(now.getTime() / 1000)
    const attempt = d.attempt + 1

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)

    try {
      const res = await doFetch(d.webhook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // 客户用此头验签，格式 t=<ts>,v1=<hmac>
          'x-rankloop-signature': signPayload(body, d.webhook.secret, timestamp),
          'x-rankloop-event': d.event,
          'x-rankloop-delivery': d.id,
        },
        body,
        signal: controller.signal,
      })

      if (res.ok) {
        await prisma.webhookDelivery.update({
          where: { id: d.id },
          data: { statusCode: res.status, attempt, deliveredAt: now, nextRetryAt: null },
        })
        result.delivered += 1
        continue
      }

      // 4xx 是客户端配置问题（地址错、鉴权失败），重试无意义；
      // 5xx 多为临时故障，值得重试
      const retryable = res.status >= 500 || res.status === 429
      await scheduleRetry(prisma, {
        id: d.id,
        attempt,
        now,
        statusCode: res.status,
        error: `HTTP ${res.status}`,
        retryable,
      })
      retryable && attempt < MAX_WEBHOOK_ATTEMPTS ? (result.retrying += 1) : (result.failed += 1)
    } catch (e) {
      // 网络错误或超时，一律可重试
      await scheduleRetry(prisma, {
        id: d.id,
        attempt,
        now,
        error: (e as Error).message.slice(0, 500),
        retryable: true,
      })
      attempt < MAX_WEBHOOK_ATTEMPTS ? (result.retrying += 1) : (result.failed += 1)
    } finally {
      clearTimeout(timer)
    }
  }

  return result
}

async function scheduleRetry(
  prisma: PrismaClient,
  params: {
    id: string
    attempt: number
    now: Date
    statusCode?: number
    error: string
    retryable: boolean
  },
): Promise<void> {
  const exhausted = !params.retryable || params.attempt >= MAX_WEBHOOK_ATTEMPTS
  await prisma.webhookDelivery.update({
    where: { id: params.id },
    data: {
      attempt: exhausted ? MAX_WEBHOOK_ATTEMPTS : params.attempt,
      statusCode: params.statusCode ?? null,
      error: params.error,
      // 放弃时清空重试时间，避免被后续轮询反复捞出来
      nextRetryAt: exhausted
        ? null
        : new Date(params.now.getTime() + nextRetryDelayMs(params.attempt)),
    },
  })
}

/** 启动周期性投递，返回停止函数 */
export function startWebhookWorker(prisma: PrismaClient, intervalMs = 15_000): () => void {
  let running = false

  const tick = async () => {
    if (running) return // 防止上一轮未完成时并发投递，否则会重复推送
    running = true
    try {
      await dispatchPending(prisma)
    } catch {
      // 单次失败不应终止 worker
    } finally {
      running = false
    }
  }

  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
