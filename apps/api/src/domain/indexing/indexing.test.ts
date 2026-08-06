import { describe, expect, it } from 'vitest'
import {
  EmptyUrlList,
  MAX_URLS_PER_SUBMISSION,
  UrlNotOwnedBySite,
  buildIndexNowPayload,
  prepareSubmission,
} from './index-now'
import { buildRobotsTxt, buildSitemap, buildSitemapIndex } from './sitemap'

const ORIGIN = 'https://example.com'

describe('IndexNow 提交校验', () => {
  it('接受属于本站的 URL', () => {
    const r = prepareSubmission({ urls: [`${ORIGIN}/a`, `${ORIGIN}/b`], origin: ORIGIN })
    expect(r.urls).toEqual([`${ORIGIN}/a`, `${ORIGIN}/b`])
  })

  it('拒绝他站 URL——否则可借平台提交他人站点', () => {
    expect(() =>
      prepareSubmission({ urls: [`${ORIGIN}/a`, 'https://evil.com/x'], origin: ORIGIN }),
    ).toThrow(UrlNotOwnedBySite)
  })

  it('异常列出具体的越权 URL，便于调用方定位', () => {
    try {
      prepareSubmission({ urls: ['https://evil.com/x'], origin: ORIGIN })
      expect.unreachable('应当抛出 UrlNotOwnedBySite')
    } catch (e) {
      expect((e as UrlNotOwnedBySite).urls).toEqual(['https://evil.com/x'])
    }
  })

  it('子域名不算同站', () => {
    expect(() =>
      prepareSubmission({ urls: ['https://sub.example.com/a'], origin: ORIGIN }),
    ).toThrow(UrlNotOwnedBySite)
  })

  it('空列表被拒绝', () => {
    expect(() => prepareSubmission({ urls: [], origin: ORIGIN })).toThrow(EmptyUrlList)
  })

  it('去重，避免重复消耗配额', () => {
    const r = prepareSubmission({ urls: [`${ORIGIN}/a`, `${ORIGIN}/a`], origin: ORIGIN })
    expect(r.urls).toEqual([`${ORIGIN}/a`])
  })

  it('超过单次上限时分批', () => {
    const urls = Array.from({ length: MAX_URLS_PER_SUBMISSION + 5 }, (_, i) => `${ORIGIN}/p${i}`)
    const r = prepareSubmission({ urls, origin: ORIGIN })
    expect(r.batches).toHaveLength(2)
    expect(r.batches[0]).toHaveLength(MAX_URLS_PER_SUBMISSION)
    expect(r.batches[1]).toHaveLength(5)
  })
})

describe('IndexNow 请求体', () => {
  it('包含协议要求的字段', () => {
    const p = buildIndexNowPayload({ host: 'example.com', key: 'abc123', urls: [`${ORIGIN}/a`] })
    expect(p.host).toBe('example.com')
    expect(p.key).toBe('abc123')
    expect(p.keyLocation).toBe('https://example.com/abc123.txt')
    expect(p.urlList).toEqual([`${ORIGIN}/a`])
  })
})

describe('Sitemap 生成', () => {
  it('生成合法 XML 并包含 URL', () => {
    const xml = buildSitemap([{ loc: `${ORIGIN}/a` }])
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain(`<loc>${ORIGIN}/a</loc>`)
  })

  it('转义特殊字符——未转义的 & 会让 XML 解析失败', () => {
    const xml = buildSitemap([{ loc: `${ORIGIN}/a?x=1&y=2` }])
    expect(xml).toContain('&amp;')
    expect(xml).not.toMatch(/[^&]&[^a]/)
  })

  it('输出 lastmod 日期', () => {
    const xml = buildSitemap([{ loc: `${ORIGIN}/a`, lastmod: new Date('2026-08-06T12:00:00Z') }])
    expect(xml).toContain('<lastmod>2026-08-06</lastmod>')
  })

  it('无 lastmod 时不输出空标签', () => {
    expect(buildSitemap([{ loc: `${ORIGIN}/a` }])).not.toContain('<lastmod>')
  })

  it('超过 5 万条时截断，不生成非法 sitemap', () => {
    const entries = Array.from({ length: 50_005 }, (_, i) => ({ loc: `${ORIGIN}/p${i}` }))
    const count = (buildSitemap(entries).match(/<loc>/g) ?? []).length
    expect(count).toBe(50_000)
  })
})

describe('Sitemap 索引', () => {
  it('列出各个 sitemap 文件', () => {
    const xml = buildSitemapIndex([`${ORIGIN}/sitemap-1.xml`, `${ORIGIN}/sitemap-2.xml`])
    expect(xml).toContain('<sitemapindex')
    expect(xml).toContain('sitemap-1.xml')
    expect(xml).toContain('sitemap-2.xml')
  })
})

describe('robots.txt', () => {
  it('声明 sitemap 位置——Google 据此自动发现', () => {
    const txt = buildRobotsTxt({ sitemapUrl: `${ORIGIN}/sitemap.xml` })
    expect(txt).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`)
    expect(txt).toContain('Allow: /')
  })

  it('可生成全站禁止抓取的版本', () => {
    expect(buildRobotsTxt({ sitemapUrl: `${ORIGIN}/sitemap.xml`, allowAll: false })).toContain(
      'Disallow: /',
    )
  })
})
