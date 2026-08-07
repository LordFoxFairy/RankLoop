import { describe, expect, it, vi } from 'vitest'
import {
  DATA_LAG_DAYS,
  type GscClient,
  fetchSearchAnalytics,
  gscSiteUrl,
  shouldSync,
  syncAllSites,
  syncWindow,
} from './gsc-sync'

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

describe('Search Console 属性地址推导', () => {
  it('已验证的自有域名优先——权重应积累在客户自己的域名下', () => {
    expect(
      gscSiteUrl({
        origin: 'https://acme.rankloop.miaokit.cloud',
        domain: 'blog.acme.com',
        domainVerifiedAt: new Date(),
      }),
    ).toBe('https://blog.acme.com/')
  })

  it('域名未验证时回退子域名——未验证的域名不能生效，否则可被劫持', () => {
    expect(
      gscSiteUrl({
        origin: 'https://acme.rankloop.miaokit.cloud',
        domain: 'blog.acme.com',
        domainVerifiedAt: null,
      }),
    ).toBe('https://acme.rankloop.miaokit.cloud/')
  })

  it('补齐尾斜杠——GSC 属性带斜杠，不一致会查不到数据且不报错', () => {
    expect(
      gscSiteUrl({ origin: 'https://acme.example.org', domain: null, domainVerifiedAt: null }),
    ).toBe('https://acme.example.org/')
  })

  it('已有尾斜杠时不重复添加', () => {
    expect(
      gscSiteUrl({ origin: 'https://acme.example.org/', domain: null, domainVerifiedAt: null }),
    ).toBe('https://acme.example.org/')
  })
})

describe('同步节流', () => {
  const NOW = new Date('2026-08-07T12:00:00Z')

  it('从未同步过的站点立即同步', () => {
    expect(shouldSync({ lastSuccessAt: null, now: NOW, intervalHours: 24 })).toBe(true)
  })

  it('距上次同步未满间隔时跳过——GSC 数据按天更新，重复拉只浪费配额', () => {
    const lastSuccessAt = new Date('2026-08-07T02:00:00Z') // 10 小时前
    expect(shouldSync({ lastSuccessAt, now: NOW, intervalHours: 24 })).toBe(false)
  })

  it('超过间隔后重新同步', () => {
    const lastSuccessAt = new Date('2026-08-06T02:00:00Z') // 34 小时前
    expect(shouldSync({ lastSuccessAt, now: NOW, intervalHours: 24 })).toBe(true)
  })

  it('恰好等于间隔时同步——边界取闭区间，避免因毫秒差永远推迟一轮', () => {
    const lastSuccessAt = new Date('2026-08-06T12:00:00Z') // 恰好 24 小时
    expect(shouldSync({ lastSuccessAt, now: NOW, intervalHours: 24 })).toBe(true)
  })
})

describe('全站自动同步', () => {
  const NOW = new Date('2026-08-07T12:00:00Z')

  /** 造一个够用的 prisma 替身，只实现 syncAllSites 走到的方法 */
  function fakePrisma(opts: {
    sites: Array<{ id: string; origin: string; domain: string | null; domainVerifiedAt: Date | null }>
    lastSuccess?: Record<string, Date>
  }) {
    return {
      site: { findMany: vi.fn().mockResolvedValue(opts.sites) },
      gscSyncJob: {
        findFirst: vi.fn(({ where }: { where: { siteId: string } }) =>
          Promise.resolve(
            opts.lastSuccess?.[where.siteId]
              ? { finishedAt: opts.lastSuccess[where.siteId] }
              : null,
          ),
        ),
        create: vi.fn().mockResolvedValue({ id: 'job1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      searchAnalytics: { upsert: vi.fn().mockResolvedValue({}) },
    } as never
  }

  const okClient: GscClient = { request: vi.fn().mockResolvedValue({ data: { rows: [] } }) }

  it('只同步有已发布内容的站点——没发布过必然没数据，同步只浪费配额', async () => {
    const prisma = fakePrisma({ sites: [] })
    await syncAllSites({ prisma, buildClient: async () => okClient, now: NOW })

    const call = (prisma as never as { site: { findMany: ReturnType<typeof vi.fn> } }).site.findMany
      .mock.calls[0][0]
    expect(call.where.contents.some.status).toBe('published')
    expect(call.where.archivedAt).toBeNull()
  })

  it('跳过距上次同步未满间隔的站点', async () => {
    const prisma = fakePrisma({
      sites: [{ id: 's1', origin: 'https://a.example.org', domain: null, domainVerifiedAt: null }],
      lastSuccess: { s1: new Date('2026-08-07T06:00:00Z') }, // 6 小时前
    })

    const r = await syncAllSites({ prisma, buildClient: async () => okClient, now: NOW })
    expect(r).toEqual({ synced: 0, skipped: 1, failed: 0 })
  })

  it('同步到期的站点', async () => {
    const prisma = fakePrisma({
      sites: [{ id: 's1', origin: 'https://a.example.org', domain: null, domainVerifiedAt: null }],
    })

    const r = await syncAllSites({ prisma, buildClient: async () => okClient, now: NOW })
    expect(r).toEqual({ synced: 1, skipped: 0, failed: 0 })
  })

  it('单个站点失败不影响其他站点——一个客户的配置错误不能拖垮全平台', async () => {
    const prisma = fakePrisma({
      sites: [
        { id: 's1', origin: 'https://a.example.org', domain: null, domainVerifiedAt: null },
        { id: 's2', origin: 'https://b.example.org', domain: null, domainVerifiedAt: null },
      ],
    })

    let n = 0
    const flaky: GscClient = {
      request: vi.fn(() => {
        n += 1
        return n === 1 ? Promise.reject(new Error('403 权限不足')) : Promise.resolve({ data: {} })
      }),
    }

    const r = await syncAllSites({ prisma, buildClient: async () => flaky, now: NOW })
    expect(r.failed).toBe(1)
    expect(r.synced).toBe(1)
  })

  it('凭据无效时整轮跳过，不把失败写成成功', async () => {
    const prisma = fakePrisma({
      sites: [{ id: 's1', origin: 'https://a.example.org', domain: null, domainVerifiedAt: null }],
    })

    const r = await syncAllSites({
      prisma,
      buildClient: async () => {
        throw new Error('服务账号 JSON 解析失败')
      },
      now: NOW,
    })
    expect(r).toEqual({ synced: 0, skipped: 0, failed: 1 })
  })

  it('没有站点时不构造客户端——避免无谓的凭据解析', async () => {
    const build = vi.fn()
    const r = await syncAllSites({ prisma: fakePrisma({ sites: [] }), buildClient: build, now: NOW })
    expect(build).not.toHaveBeenCalled()
    expect(r.synced).toBe(0)
  })
})
