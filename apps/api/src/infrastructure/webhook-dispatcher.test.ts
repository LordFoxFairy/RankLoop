import { describe, expect, it, vi } from 'vitest'
import { MAX_WEBHOOK_ATTEMPTS } from '../shared/webhook'
import { dispatchPending } from './webhook-dispatcher'

/**
 * 投递语义测试。
 *
 * 重点是「什么该重试、什么不该」：4xx 是客户配错了地址或鉴权，
 * 重试八次只是白白打扰对方；5xx 和超时是临时故障，值得重试。
 */

const NOW = new Date('2026-08-07T12:00:00Z')

function delivery(over: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    event: 'content.gate_failed',
    payload: { event: 'content.gate_failed', event_id: 'e1' },
    attempt: 0,
    webhook: {
      id: 'w1',
      url: 'https://hooks.acme.com/x',
      secret: 'whsec_test_secret_value',
      enabled: true,
    },
    ...over,
  }
}

function fakePrisma(rows: unknown[]) {
  const update = vi.fn().mockResolvedValue({})
  return {
    prisma: {
      webhookDelivery: { findMany: vi.fn().mockResolvedValue(rows), update },
    } as never,
    update,
  }
}

describe('webhook 投递', () => {
  it('2xx 记为送达', async () => {
    const { prisma, update } = fakePrisma([delivery()])
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 })

    const r = await dispatchPending(prisma, { now: NOW, fetchImpl: fetchImpl as never })

    expect(r.delivered).toBe(1)
    expect(update.mock.calls[0][0].data.deliveredAt).toEqual(NOW)
    // 送达后不该再被轮询捞出来
    expect(update.mock.calls[0][0].data.nextRetryAt).toBeNull()
  })

  it('请求带签名头，客户据此验签', async () => {
    const { prisma } = fakePrisma([delivery()])
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 })

    await dispatchPending(prisma, { now: NOW, fetchImpl: fetchImpl as never })

    const headers = fetchImpl.mock.calls[0][1].headers
    expect(headers['x-rankloop-signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/)
    expect(headers['x-rankloop-event']).toBe('content.gate_failed')
  })

  it('4xx 不重试——地址错或鉴权失败，重试只是打扰客户', async () => {
    const { prisma, update } = fakePrisma([delivery()])
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    const r = await dispatchPending(prisma, { now: NOW, fetchImpl: fetchImpl as never })

    expect(r.failed).toBe(1)
    expect(r.retrying).toBe(0)
    expect(update.mock.calls[0][0].data.nextRetryAt).toBeNull()
    expect(update.mock.calls[0][0].data.attempt).toBe(MAX_WEBHOOK_ATTEMPTS)
  })

  it('5xx 安排重试——多为临时故障', async () => {
    const { prisma, update } = fakePrisma([delivery()])
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 })

    const r = await dispatchPending(prisma, { now: NOW, fetchImpl: fetchImpl as never })

    expect(r.retrying).toBe(1)
    expect(update.mock.calls[0][0].data.nextRetryAt).toBeInstanceOf(Date)
  })

  it('429 重试——限流是临时的，不是配置错误', async () => {
    const { prisma, update } = fakePrisma([delivery()])
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 })

    await dispatchPending(prisma, { now: NOW, fetchImpl: fetchImpl as never })
    expect(update.mock.calls[0][0].data.nextRetryAt).toBeInstanceOf(Date)
  })

  it('网络错误安排重试', async () => {
    const { prisma, update } = fakePrisma([delivery()])
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    const r = await dispatchPending(prisma, { now: NOW, fetchImpl: fetchImpl as never })

    expect(r.retrying).toBe(1)
    expect(update.mock.calls[0][0].data.error).toContain('ECONNREFUSED')
  })

  it('达到最大次数后放弃，不再无限重试', async () => {
    const { prisma, update } = fakePrisma([delivery({ attempt: MAX_WEBHOOK_ATTEMPTS - 1 })])
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 })

    const r = await dispatchPending(prisma, { now: NOW, fetchImpl: fetchImpl as never })

    expect(r.failed).toBe(1)
    expect(update.mock.calls[0][0].data.nextRetryAt).toBeNull()
  })

  it('已停用的 webhook 不再投递', async () => {
    const { prisma, update } = fakePrisma([
      delivery({ webhook: { id: 'w1', url: 'https://x/y', secret: 's', enabled: false } }),
    ])
    const fetchImpl = vi.fn()

    const r = await dispatchPending(prisma, { now: NOW, fetchImpl: fetchImpl as never })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(r.failed).toBe(1)
    expect(update.mock.calls[0][0].data.error).toContain('停用')
  })

  it('只捞到期且未送达的记录', async () => {
    const { prisma } = fakePrisma([])
    await dispatchPending(prisma, { now: NOW, fetchImpl: vi.fn() as never })

    const where = (prisma as never as {
      webhookDelivery: { findMany: ReturnType<typeof vi.fn> }
    }).webhookDelivery.findMany.mock.calls[0][0].where

    expect(where.deliveredAt).toBeNull()
    expect(where.nextRetryAt.lte).toEqual(NOW)
    expect(where.attempt.lt).toBe(MAX_WEBHOOK_ATTEMPTS)
  })

  it('一条失败不影响后续投递', async () => {
    const { prisma } = fakePrisma([delivery({ id: 'd1' }), delivery({ id: 'd2' })])
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const r = await dispatchPending(prisma, { now: NOW, fetchImpl: fetchImpl as never })

    expect(r.delivered).toBe(1)
    expect(r.retrying).toBe(1)
  })
})
