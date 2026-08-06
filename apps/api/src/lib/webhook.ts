import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

/**
 * Webhook 签名与 payload 构造（规格 §7.5）。
 *
 * 采用轻 payload（ADR-001 §7）：只带事件类型、资源 ID 与拉取链接，
 * 第三方凭 API Key 回调获取详情。避免大站点 payload 膨胀，
 * 且重试时第三方拿到的始终是最新状态。
 */

export const WEBHOOK_EVENTS = [
  'content.checked',
  'content.published',
  'content.gate_failed',
  'indexnow.completed',
  'indexnow.failed',
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export interface WebhookPayload {
  event: WebhookEvent
  /** 事件唯一 ID，供接收方去重（至少一次投递语义） */
  event_id: string
  /** Unix 秒。接收方应拒绝过旧的请求以防重放 */
  timestamp: number
  workspace_id: string
  site_id?: string
  data: Record<string, unknown>
  links: Record<string, string>
}

export function buildPayload(params: {
  event: WebhookEvent
  workspaceId: string
  siteId?: string
  data: Record<string, unknown>
  links: Record<string, string>
  eventId?: string
  timestamp?: number
}): WebhookPayload {
  return {
    event: params.event,
    event_id: params.eventId ?? randomUUID(),
    timestamp: params.timestamp ?? Math.floor(Date.now() / 1000),
    workspace_id: params.workspaceId,
    site_id: params.siteId,
    data: params.data,
    links: params.links,
  }
}

/**
 * 签名覆盖 timestamp 与 body，防止重放时篡改时间戳。
 * 格式：`t=<timestamp>,v1=<hex>`，与主流实现一致，便于第三方接入。
 */
export function signPayload(body: string, secret: string, timestamp: number): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return `t=${timestamp},v1=${mac}`
}

export function verifySignature(params: {
  body: string
  secret: string
  header: string
  /** 容忍的时钟偏差与传输延迟，超出即视为重放 */
  toleranceSeconds?: number
  now?: number
}): boolean {
  const { body, secret, header, toleranceSeconds = 300 } = params
  const now = params.now ?? Math.floor(Date.now() / 1000)

  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const idx = kv.indexOf('=')
      return idx === -1 ? [kv, ''] : [kv.slice(0, idx), kv.slice(idx + 1)]
    }),
  )

  const timestamp = Number(parts.t)
  const provided = parts.v1
  if (!Number.isFinite(timestamp) || !provided) return false
  if (Math.abs(now - timestamp) > toleranceSeconds) return false

  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  const a = Buffer.from(provided, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** 指数退避 + 随机抖动（规格 §9），避免大量 webhook 同时重试打垮接收方 */
export function nextRetryDelayMs(attempt: number, random = Math.random): number {
  const base = Math.min(2 ** attempt * 1000, 6 * 60 * 60 * 1000)
  return Math.floor(base * (0.5 + random() * 0.5))
}

export const MAX_WEBHOOK_ATTEMPTS = 8
