import { describe, expect, it, vi } from 'vitest'
import { DATA_LAG_DAYS, type GscClient, fetchSearchAnalytics, syncWindow } from './gsc-sync'

describe('同步区间', () => {
  const NOW = new Date('2026-08-07T00:00:00Z')

  it('结束日回退数据延迟天数——更近的数据 Google 还没算出来', () => {
    const w = syncWindow(NOW, 28)
    expect(w.end).toBe('2026-08-04')
    expect(DATA_LAG_DAYS).toBe(3)
  })

  it('区间长度等于请求天数', () => {
    const w = syncWindow(NOW, 7)
    const days =
      (new Date(w.end).getTime() - new Date(w.start).getTime()) / 86_400_000 + 1
    expect(days).toBe(7)
  })

  it('单日同步时起止相同', () => {
    const w = syncWindow(NOW, 1)
    expect(w.start).toBe(w.end)
  })

  it('跨月边界正确', () => {
    const w = syncWindow(new Date('2026-03-02T00:00:00Z'), 5)
    expect(w.end).toBe('2026-02-27')
    expect(w.start).toBe('2026-02-23')
  })
})

function fakeClient(pages: unknown[][]): GscClient {
  let i = 0
  return {
    request: vi.fn(async () => ({ data: { rows: pages[i++] ?? [] } })),
  }
}

describe('拉取搜索表现', () => {
  it('返回 API 中的行', async () => {
    const client = fakeClient([[{ keys: ['2026-08-01', 'seo', '/a'], clicks: 5 }]])
    const rows = await fetchSearchAnalytics({
      client,
      siteUrl: 'https://x.com/',
      startDate: '2026-08-01',
      endDate: '2026-08-01',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].clicks).toBe(5)
  })

  it('不足一页时停止分页——继续请求只会浪费配额', async () => {
    const client = fakeClient([[{ keys: ['2026-08-01'] }]])
    await fetchSearchAnalytics({
      client,
      siteUrl: 'https://x.com/',
      startDate: '2026-08-01',
      endDate: '2026-08-01',
    })
    expect(client.request).toHaveBeenCalledTimes(1)
  })

  it('满页时继续翻页', async () => {
    const full = Array.from({ length: 25_000 }, () => ({ keys: ['2026-08-01'] }))
    const client = fakeClient([full, [{ keys: ['2026-08-02'] }]])
    const rows = await fetchSearchAnalytics({
      client,
      siteUrl: 'https://x.com/',
      startDate: '2026-08-01',
      endDate: '2026-08-02',
    })
    expect(client.request).toHaveBeenCalledTimes(2)
    expect(rows).toHaveLength(25_001)
  })

  it('受 maxPages 限制，避免无限翻页', async () => {
    const full = Array.from({ length: 25_000 }, () => ({ keys: ['2026-08-01'] }))
    const client = fakeClient([full, full, full, full, full, full])
    await fetchSearchAnalytics({
      client,
      siteUrl: 'https://x.com/',
      startDate: '2026-08-01',
      endDate: '2026-08-02',
      maxPages: 2,
    })
    expect(client.request).toHaveBeenCalledTimes(2)
  })

  it('请求体包含正确的维度与日期', async () => {
    const client = fakeClient([[]])
    await fetchSearchAnalytics({
      client,
      siteUrl: 'https://x.com/',
      startDate: '2026-08-01',
      endDate: '2026-08-05',
    })
    const call = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.data).toMatchObject({
      startDate: '2026-08-01',
      endDate: '2026-08-05',
      dimensions: ['date', 'query', 'page'],
    })
  })

  it('URL 中的站点地址被编码', async () => {
    const client = fakeClient([[]])
    await fetchSearchAnalytics({
      client,
      siteUrl: 'https://x.com/',
      startDate: '2026-08-01',
      endDate: '2026-08-01',
    })
    const call = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.url).toContain(encodeURIComponent('https://x.com/'))
  })

  it('API 返回空结果时不报错', async () => {
    const client: GscClient = { request: vi.fn(async () => ({ data: {} })) }
    const rows = await fetchSearchAnalytics({
      client,
      siteUrl: 'https://x.com/',
      startDate: '2026-08-01',
      endDate: '2026-08-01',
    })
    expect(rows).toEqual([])
  })
})
