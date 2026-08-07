import { describe, expect, it, vi } from 'vitest'
import { GSC_WRITE_SCOPE, sitemapUrlFor, submitSitemap } from './gsc-sitemap'
import type { GscClient } from './gsc-sync'

describe('提交 sitemap 到 Search Console', () => {
  it('用 PUT 提交，路径中的站点与 sitemap 地址都要编码', async () => {
    const client: GscClient = { request: vi.fn(async () => ({ data: {} })) }
    await submitSitemap({
      client,
      siteUrl: 'https://acme.example.org/',
      sitemapUrl: 'https://acme.example.org/sitemap.xml',
    })

    const call = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.method).toBe('PUT')
    expect(call.url).toContain(encodeURIComponent('https://acme.example.org/'))
    expect(call.url).toContain(encodeURIComponent('https://acme.example.org/sitemap.xml'))
  })

  it('失败时如实返回原因而不抛出——批量循环中单站失败不该中断其他站点', async () => {
    const client: GscClient = {
      request: vi.fn(async () => {
        throw new Error('403 服务账号无权访问该属性')
      }),
    }

    const r = await submitSitemap({
      client,
      siteUrl: 'https://acme.example.org/',
      sitemapUrl: 'https://acme.example.org/sitemap.xml',
    })

    expect(r.submitted).toBe(false)
    expect(r.error).toContain('403')
  })

  it('成功时标记为已提交', async () => {
    const client: GscClient = { request: vi.fn(async () => ({ data: {} })) }
    const r = await submitSitemap({
      client,
      siteUrl: 'https://acme.example.org/',
      sitemapUrl: 'https://acme.example.org/sitemap.xml',
    })
    expect(r.submitted).toBe(true)
  })

  it('使用写权限 scope——只读 scope 提交会被 Google 拒绝', () => {
    // 这是本功能能否工作的前提，写死以防有人「优化」回只读
    expect(GSC_WRITE_SCOPE).toBe('https://www.googleapis.com/auth/webmasters')
    expect(GSC_WRITE_SCOPE).not.toContain('readonly')
  })
})

describe('sitemap 地址推导', () => {
  it('与 public-site 渲染的路径一致', () => {
    expect(sitemapUrlFor('https://acme.example.org')).toBe('https://acme.example.org/sitemap.xml')
  })

  it('origin 带尾斜杠时不产生双斜杠', () => {
    expect(sitemapUrlFor('https://acme.example.org/')).toBe('https://acme.example.org/sitemap.xml')
  })
})
