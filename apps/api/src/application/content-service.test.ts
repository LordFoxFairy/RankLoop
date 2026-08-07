import { describe, expect, it, vi } from 'vitest'
import { seoChecker } from '../infrastructure/seo-checker'
import { ContentService, type ContentServiceDeps } from './content-service'

/**
 * 发布用例的自动通知行为。
 *
 * 重点不是「调没调通知」，而是「通知挂了会不会把发布也带崩」——
 * 内容已经落库上线，此时谎称发布失败比漏一次通知严重得多。
 */

const GOOD_HTML = `<html lang="zh"><head><title>一个足够长的测试页面标题</title>
<meta name="description" content="这是一段长度合适的描述文本，用来通过描述相关的检测规则，避免触发阻断发布的严重问题。">
<link rel="canonical" href="https://x.example.org/a"></head>
<body><h1>一个足够长的测试页面标题</h1><p>${'正文内容需要足够长才能通过内容过少的检测。'.repeat(12)}</p></body></html>`

function buildDeps(overrides: Partial<ContentServiceDeps> = {}): ContentServiceDeps {
  const store = new Map<string, unknown>()
  let n = 0

  return {
    contents: {
      findById: vi.fn(async (id: string) => store.get(id) ?? null),
      findByIdAnyTenant: vi.fn(async (id: string) => store.get(id) ?? null),
      findByPath: vi.fn(async () => null),
      listBySite: vi.fn(async () => []),
      countByWorkspace: vi.fn(async () => 0),
      add: vi.fn(async (c: { id: string }) => void store.set(c.id, c)),
      save: vi.fn(async (c: { id: string }) => void store.set(c.id, c)),
      nextVersionNumber: vi.fn(async () => 2),
    },
    sites: { findById: vi.fn(async () => ({ id: 'site1', origin: 'https://x.example.org' })) },
    quotas: { findByWorkspace: vi.fn(async () => ({ maxContents: 100 })) },
    // 用真实的检测适配器，避免测试里重写一套解析逻辑而与线上行为不一致
    checker: seoChecker,
    ids: { next: () => `id-${++n}` },
    clock: { now: () => new Date('2026-08-07T00:00:00Z') },
    ...overrides,
  } as ContentServiceDeps
}

async function publishOne(deps: ContentServiceDeps) {
  const svc = new ContentService(deps)
  const c = await svc.submit({
    siteId: 'site1',
    workspaceId: 'ws1',
    path: '/a',
    format: 'html',
    body: GOOD_HTML,
  })
  return svc.publish(c.id, 'ws1')
}

describe('发布后自动通知搜索引擎', () => {
  it('发布成功后通知内容已上线', async () => {
    const contentPublished = vi.fn(async () => {})
    await publishOne(buildDeps({ notifier: { contentPublished } }))

    expect(contentPublished).toHaveBeenCalledTimes(1)
    expect(contentPublished.mock.calls[0][0]).toMatchObject({
      siteId: 'site1',
      url: 'https://x.example.org/a',
    })
  })

  it('通知失败不影响发布——内容已上线，谎称失败更糟', async () => {
    const contentPublished = vi.fn(async () => {
      throw new Error('IndexNow 服务不可用')
    })

    const content = await publishOne(buildDeps({ notifier: { contentPublished } }))

    expect(contentPublished).toHaveBeenCalled()
    expect(content.status).toBe('published')
  })

  it('未配置通知器时发布照常进行', async () => {
    const content = await publishOne(buildDeps())
    expect(content.status).toBe('published')
  })

  it('被门槛拦截时不通知——内容没上线，通知了会让爬虫抓到 404', async () => {
    const contentPublished = vi.fn(async () => {})
    const deps = buildDeps({ notifier: { contentPublished } })
    const svc = new ContentService(deps)

    const c = await svc.submit({
      siteId: 'site1',
      workspaceId: 'ws1',
      path: '/bad',
      format: 'html',
      body: '<html><body></body></html>', // 缺标题、无正文，必被拦
    })

    await expect(svc.publish(c.id, 'ws1')).rejects.toThrow()
    expect(contentPublished).not.toHaveBeenCalled()
  })

  it('先落库再通知——顺序反了爬虫会抓到尚未上线的地址', async () => {
    const order: string[] = []
    const deps = buildDeps({
      notifier: { contentPublished: vi.fn(async () => void order.push('notify')) },
    })
    const origSave = deps.contents.save
    deps.contents.save = vi.fn(async (c) => {
      order.push('save')
      return origSave(c)
    })

    await publishOne(deps)
    expect(order[order.length - 2]).toBe('save')
    expect(order[order.length - 1]).toBe('notify')
  })
})
