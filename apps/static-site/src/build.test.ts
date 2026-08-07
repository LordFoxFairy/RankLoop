import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { build } from './build'

const SITE = 'https://example.com'

let contentDir: string
let outDir: string

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'rankloop-'))
  contentDir = join(root, 'content')
  outDir = join(root, 'out')
  mkdirSync(contentDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })
})

function write(name: string, body: string): void {
  const full = join(contentDir, name)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, body, 'utf8')
}

const GOOD = `---
title: 如何优化网站的搜索引擎排名完整实战指南
description: 本文详细介绍网站 SEO 优化的核心方法，涵盖标题撰写、描述优化、结构化数据标记与内链建设等关键环节的实操内容。
canonical: https://example.com/good
lang: zh-CN
og:
  title: SEO
  description: 指南
  image: https://example.com/og.png
---

# 如何优化网站的搜索引擎排名

${'这是一段实质性的正文内容，用于说明具体做法。'.repeat(25)}

![示意图](/i.png)

[关键词研究](/x) 和 [内链建设](/y)
`

function run(ignoreGate = false) {
  return build({ contentDir, outDir, siteUrl: SITE, siteName: 'Test', ignoreGate })
}

describe('静态站构建', () => {
  it('合格内容被构建成 HTML', () => {
    write('good.md', GOOD)
    const r = run()
    expect(r.built).toBe(1)
    expect(r.blocked).toBe(0)
    expect(existsSync(join(outDir, 'good/index.html'))).toBe(true)
  })

  it('index.md 映射到站点根路径', () => {
    write('index.md', GOOD.replace('/good', '/'))
    const r = run()
    expect(r.pages[0].path).toBe('/')
    expect(existsSync(join(outDir, 'index.html'))).toBe(true)
  })

  it('嵌套目录保留路径结构', () => {
    write('blog/post.md', GOOD.replace('https://example.com/good', 'https://example.com/blog/post'))
    const r = run()
    expect(r.pages[0].path).toBe('/blog/post')
    expect(existsSync(join(outDir, 'blog/post/index.html'))).toBe(true)
  })
})

describe('发布门槛', () => {
  // 这是整套机制的核心：不合格内容绝不能进入线上站点
  it('存在 critical 问题的内容不生成 HTML', () => {
    write('bad.md', '# x\n\n短')
    const r = run()
    expect(r.blocked).toBe(1)
    expect(r.built).toBe(0)
    expect(existsSync(join(outDir, 'bad/index.html'))).toBe(false)
  })

  it('被拦截的内容记录具体阻塞规则', () => {
    write('bad.md', '# x\n\n短')
    const blocking = run().pages[0].blocking
    expect(blocking).toContain('MISSING_TITLE')
    expect(blocking).toContain('EMPTY_CONTENT')
  })

  it('单篇不合格不影响其余内容构建', () => {
    write('good.md', GOOD)
    write('bad.md', '# x\n\n短')
    const r = run()
    expect(r.built).toBe(1)
    expect(r.blocked).toBe(1)
    expect(existsSync(join(outDir, 'good/index.html'))).toBe(true)
    expect(existsSync(join(outDir, 'bad/index.html'))).toBe(false)
  })

  it('ignoreGate 仅用于本地预览时才放行', () => {
    write('bad.md', '# x\n\n短')
    expect(run(true).built).toBe(1)
  })
})

describe('生成的 HTML', () => {
  it('包含完整的 SEO head 标签', () => {
    write('good.md', GOOD)
    run()
    const html = readFileSync(join(outDir, 'good/index.html'), 'utf8')
    expect(html).toContain('<title>如何优化网站的搜索引擎排名完整实战指南</title>')
    expect(html).toContain('name="description"')
    expect(html).toContain('rel="canonical"')
    expect(html).toContain('property="og:title"')
    expect(html).toContain('lang="zh-CN"')
  })

  it('canonical 缺失时用页面自身地址兜底，避免重复内容', () => {
    write(
      'nocanon.md',
      GOOD.replace('canonical: https://example.com/good\n', ''),
    )
    run()
    const html = readFileSync(join(outDir, 'nocanon/index.html'), 'utf8')
    expect(html).toContain('href="https://example.com/nocanon/"')
  })

  it('转义标题中的 HTML，防止注入', () => {
    write(
      'xss.md',
      GOOD.replace(
        '如何优化网站的搜索引擎排名完整实战指南',
        '标题<script>alert(1)</script>注入测试内容',
      ),
    )
    run()
    const html = readFileSync(join(outDir, 'xss/index.html'), 'utf8')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('渲染 Markdown 正文为 HTML', () => {
    write('good.md', GOOD)
    run()
    const html = readFileSync(join(outDir, 'good/index.html'), 'utf8')
    expect(html).toContain('<h1>')
    expect(html).toContain('<img')
  })
})

describe('子路径部署（GitHub Pages）', () => {
  // 站点在 /repo/ 子路径下时，正文里的 /about 会被解析成 域名/about —— 全是 404。
  // 满页死链会被 Google 判定为低质量站点，是最容易被忽略的 SEO 杀手。
  const PORTABLE = GOOD.replace('canonical: https://example.com/good\n', '')

  it('改写站内链接以包含 base path', () => {
    write('good.md', PORTABLE)
    build({ contentDir, outDir, siteUrl: 'https://u.github.io/repo', siteName: 'T' })
    const html = readFileSync(join(outDir, 'good/index.html'), 'utf8')
    expect(html).toContain('href="/repo/x/"')
    expect(html).toContain('src="/repo/i.png"')
  })

  it('不改写外部链接', () => {
    write('ext.md', PORTABLE.replace('[关键词研究](/x)', '[外部站点](https://other.com/page)'))
    build({ contentDir, outDir, siteUrl: 'https://u.github.io/repo', siteName: 'T' })
    const html = readFileSync(join(outDir, 'ext/index.html'), 'utf8')
    expect(html).toContain('href="https://other.com/page"')
    expect(html).not.toContain('/repo/https')
  })

  it('部署在根域名时不改写链接', () => {
    write('good.md', GOOD)
    build({ contentDir, outDir, siteUrl: SITE, siteName: 'T' })
    const html = readFileSync(join(outDir, 'good/index.html'), 'utf8')
    expect(html).toContain('href="/x/"')
    expect(html).not.toContain('/repo/')
  })
})

describe('域名无关性', () => {
  // 内容里写死域名，换域名时会全站触发 CANONICAL_CROSS_DOMAIN
  const NO_CANON = GOOD.replace('canonical: https://example.com/good\n', '')

  it('canonical 由 SITE_URL 生成，换域名不需要改内容', () => {
    write('a.md', NO_CANON)
    const r1 = build({ contentDir, outDir, siteUrl: 'https://one.com', siteName: 'T' })
    const r2 = build({ contentDir, outDir, siteUrl: 'https://two.com', siteName: 'T' })
    expect(r1.blocked).toBe(0)
    expect(r2.blocked).toBe(0)
    expect(readFileSync(join(outDir, 'a/index.html'), 'utf8')).toContain('https://two.com/a')
  })

  it('frontmatter 显式指定的 canonical 优先', () => {
    write('b.md', GOOD)
    build({ contentDir, outDir, siteUrl: SITE, siteName: 'T' })
    expect(readFileSync(join(outDir, 'b/index.html'), 'utf8')).toContain('https://example.com/good')
  })

  it('缺省 og:image 由构建注入', () => {
    write('c.md', NO_CANON.replace('  image: https://example.com/og.png\n', ''))
    build({ contentDir, outDir, siteUrl: SITE, siteName: 'T', defaultOgImage: `${SITE}/og.png` })
    expect(readFileSync(join(outDir, 'c/index.html'), 'utf8')).toContain('og:image')
  })
})

describe('URL 规范化', () => {
  const PORTABLE2 = GOOD.replace('canonical: https://example.com/good\n', '')

  it('canonical 使用目录索引形式（带尾斜杠），与服务器实际地址一致', () => {
    write('a.md', PORTABLE2)
    const r = build({ contentDir, outDir, siteUrl: SITE, siteName: 'T' })
    expect(r.pages[0].url).toBe('https://example.com/a/')
  })

  it('首页 canonical 只有一个斜杠', () => {
    write('index.md', PORTABLE2)
    const r = build({ contentDir, outDir, siteUrl: SITE, siteName: 'T' })
    expect(r.pages[0].url).toBe('https://example.com/')
  })

  it('正文站内链接补尾斜杠，避免 301 跳转', () => {
    write('b.md', PORTABLE2)
    build({ contentDir, outDir, siteUrl: SITE, siteName: 'T' })
    const html = readFileSync(join(outDir, 'b/index.html'), 'utf8')
    expect(html).toContain('href="/x/"')
    expect(html).not.toContain('href="/x"')
  })

  it('图片等带扩展名的地址不加尾斜杠', () => {
    write('c.md', PORTABLE2)
    build({ contentDir, outDir, siteUrl: SITE, siteName: 'T' })
    const html = readFileSync(join(outDir, 'c/index.html'), 'utf8')
    expect(html).toContain('src="/i.png"')
    expect(html).not.toContain('/i.png/')
  })
})

describe('结构化数据', () => {
  // Google 用 JSON-LD 判断页面类型与主题，是获得富媒体搜索结果的前提
  it('自动生成合法的 Article JSON-LD', () => {
    write('good.md', GOOD)
    run()
    const html = readFileSync(join(outDir, 'good/index.html'), 'utf8')
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
    expect(m).not.toBeNull()
    const data = JSON.parse(m![1])
    expect(data['@type']).toBe('Article')
    expect(data.headline).toContain('如何优化网站')
    expect(data.url).toBe('https://example.com/good')
  })

  it('JSON-LD 必须是可解析的合法 JSON', () => {
    // 解析失败的 JSON-LD 会被 Google 直接忽略，等于没写
    write('good.md', GOOD)
    run()
    const html = readFileSync(join(outDir, 'good/index.html'), 'utf8')
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
    expect(() => JSON.parse(m![1])).not.toThrow()
  })
})

describe('构建统计', () => {
  it('计算平均健康分', () => {
    write('good.md', GOOD)
    // 本用例验证的是「有没有算平均分」，不是某个具体分值；
    // 写死 100 会让每次新增规则都误报失败。GOOD 无结构化数据，
    // 因此现在是 97——仍远高于门槛，不影响本用例的意图。
    const avg = run().averageScore
    expect(avg).toBeGreaterThanOrEqual(90)
    expect(avg).toBeLessThanOrEqual(100)
  })

  it('无内容时平均分为 null 而非 0', () => {
    // 0 分会被误读为「内容很差」，null 才表示「没有数据」
    expect(run().averageScore).toBeNull()
  })
})
