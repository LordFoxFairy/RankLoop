import { describe, expect, it, vi } from 'vitest'
import { dispatchPendingSubmissions } from './indexnow-dispatcher'

/**
 * 用最小的 Prisma 替身验证投递状态机，不依赖真实数据库。
 * 关注点：什么情况落终态、什么情况保持 queued 等重试。
 */
function fakePrisma(submissions: Array<Record<string, unknown>>) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = []
  return {
    updates,
    client: {
      indexNowSubmission: {
        findMany: async () => submissions,
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id: where.id, data })
          return {}
        },
      },
    } as never,
  }
}

function submission(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    urls: ['https://example.com/a'],
    site: { origin: 'https://example.com', indexNowKey: { key: 'k'.repeat(16) } },
    ...overrides,
  }
}

describe('IndexNow 投递', () => {
  it('成功时标记 succeeded 并记录响应码', async () => {
    const { client, updates } = fakePrisma([submission()])
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'OK' })

    const r = await dispatchPendingSubmissions(client, { fetchImpl: fetchImpl as never })

    expect(r.succeeded).toBe(1)
    expect(updates[0].data.status).toBe('succeeded')
    expect(updates[0].data.responseCode).toBe(200)
  })

  it('向 IndexNow 端点发送协议要求的请求体', async () => {
    const { client } = fakePrisma([submission()])
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' })

    await dispatchPendingSubmissions(client, { fetchImpl: fetchImpl as never })

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toContain('indexnow')
    const body = JSON.parse((init as { body: string }).body)
    expect(body.host).toBe('example.com')
    expect(body.urlList).toEqual(['https://example.com/a'])
    expect(body.keyLocation).toContain('.txt')
  })

  it('4xx 视为不可重试，直接标记 failed', async () => {
    // 请求本身有问题（如 Key 无效），重试只会浪费配额
    const { client, updates } = fakePrisma([submission()])
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'bad key' })

    const r = await dispatchPendingSubmissions(client, { fetchImpl: fetchImpl as never })

    expect(r.failed).toBe(1)
    expect(updates[0].data.status).toBe('failed')
  })

  it('5xx 保持 queued 等待下次重试', async () => {
    const { client, updates } = fakePrisma([submission()])
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'busy' })

    const r = await dispatchPendingSubmissions(client, { fetchImpl: fetchImpl as never })

    expect(r.failed).toBe(0)
    expect(updates[0].data.status).toBeUndefined()
    expect(updates[0].data.responseCode).toBe(503)
  })

  it('429 保持 queued——限流应当稍后重试', async () => {
    const { client, updates } = fakePrisma([submission()])
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '' })

    await dispatchPendingSubmissions(client, { fetchImpl: fetchImpl as never })

    expect(updates[0].data.status).toBeUndefined()
  })

  it('网络异常保持 queued 并记录原因', async () => {
    const { client, updates } = fakePrisma([submission()])
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'))

    await dispatchPendingSubmissions(client, { fetchImpl: fetchImpl as never })

    expect(updates[0].data.status).toBeUndefined()
    expect(String(updates[0].data.responseSummary)).toContain('ECONNRESET')
  })

  it('缺少 Key 时直接失败，不发请求', async () => {
    const { client, updates } = fakePrisma([
      submission({ site: { origin: 'https://example.com', indexNowKey: null } }),
    ])
    const fetchImpl = vi.fn()

    const r = await dispatchPendingSubmissions(client, { fetchImpl: fetchImpl as never })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(r.failed).toBe(1)
    expect(updates[0].data.status).toBe('failed')
  })

  it('origin 非法时失败，不发请求', async () => {
    const { client, updates } = fakePrisma([
      submission({ site: { origin: 'not-a-url', indexNowKey: { key: 'k'.repeat(16) } } }),
    ])
    const fetchImpl = vi.fn()

    await dispatchPendingSubmissions(client, { fetchImpl: fetchImpl as never })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(updates[0].data.status).toBe('failed')
  })

  it('无待处理记录时不发任何请求', async () => {
    const { client } = fakePrisma([])
    const fetchImpl = vi.fn()

    const r = await dispatchPendingSubmissions(client, { fetchImpl: fetchImpl as never })

    expect(r.processed).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('逐条处理多个提交，单条失败不影响其余', async () => {
    const { client, updates } = fakePrisma([
      submission({ id: 'a' }),
      submission({ id: 'b', site: { origin: 'https://example.com', indexNowKey: null } }),
      submission({ id: 'c' }),
    ])
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' })

    const r = await dispatchPendingSubmissions(client, { fetchImpl: fetchImpl as never })

    expect(r.processed).toBe(3)
    expect(r.succeeded).toBe(2)
    expect(r.failed).toBe(1)
    expect(updates.map((u) => u.id)).toEqual(['a', 'b', 'c'])
  })
})
