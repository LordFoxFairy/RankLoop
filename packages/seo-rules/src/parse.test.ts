import { describe, expect, it } from 'vitest'
import { runRules } from './engine'
import { parseContent } from './parse'

const URL = 'https://example.com/article'

describe('HTML 解析', () => {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <title>如何优化网站的搜索引擎排名</title>
  <meta name="description" content="本文详细介绍 SEO 优化的核心方法，涵盖标题、描述与内链建设等关键环节。">
  <link rel="canonical" href="https://example.com/article">
  <meta property="og:title" content="SEO 指南">
  <meta property="og:description" content="完整指南">
  <script type="application/ld+json">{"@type":"Article"}</script>
</head>
<body>
  <h1>如何优化网站的搜索引擎排名</h1>
  <h2>标题优化</h2>
  <img src="/a.png" alt="示意图">
  <img src="/b.png">
  <a href="/other">站内链接</a>
  <a href="https://external.com">站外链接</a>
</body>
</html>`

  it('提取 head 全部字段', () => {
    const { doc } = parseContent({ format: 'html', body: html, url: URL })
    expect(doc.head.title).toBe('如何优化网站的搜索引擎排名')
    expect(doc.head.canonical).toBe('https://example.com/article')
    expect(doc.head.lang).toBe('zh-CN')
    expect(doc.head.openGraph?.title).toBe('SEO 指南')
  })

  it('提取标题层级', () => {
    const { doc } = parseContent({ format: 'html', body: html, url: URL })
    expect(doc.body.headings).toEqual([
      { level: 1, text: '如何优化网站的搜索引擎排名' },
      { level: 2, text: '标题优化' },
    ])
  })

  it('区分有无 alt 的图片', () => {
    const { doc } = parseContent({ format: 'html', body: html, url: URL })
    expect(doc.body.images).toEqual([
      { src: '/a.png', alt: '示意图' },
      { src: '/b.png', alt: undefined },
    ])
  })

  it('正确区分内链与外链', () => {
    const { doc } = parseContent({ format: 'html', body: html, url: URL })
    expect(doc.body.links.filter((l) => l.internal).map((l) => l.href)).toEqual(['/other'])
    expect(doc.body.links.filter((l) => !l.internal).map((l) => l.href)).toEqual([
      'https://external.com',
    ])
  })

  it('title 不计入正文长度', () => {
    // head 里的文本若混进正文，会让空页面判定失效
    const empty = `<html><head><title>${'长'.repeat(200)}</title></head><body></body></html>`
    const { doc } = parseContent({ format: 'html', body: empty, url: URL })
    expect(doc.body.text.length).toBeLessThan(50)
  })
})

describe('Markdown 解析', () => {
  const md = `---
title: 如何优化网站的搜索引擎排名
description: 本文详细介绍 SEO 优化的核心方法，涵盖标题、描述与内链建设等关键环节。
canonical: https://example.com/article
lang: zh-CN
og:
  title: SEO 指南
  description: 完整指南
---

# 如何优化网站的搜索引擎排名

## 标题优化

![示意图](/a.png)

[站内链接](/other)
`

  it('从 frontmatter 提取元数据', () => {
    const { doc } = parseContent({ format: 'markdown', body: md, url: URL })
    expect(doc.head.title).toBe('如何优化网站的搜索引擎排名')
    expect(doc.head.canonical).toBe('https://example.com/article')
    expect(doc.head.lang).toBe('zh-CN')
    expect(doc.head.openGraph?.title).toBe('SEO 指南')
  })

  it('frontmatter 不混入正文', () => {
    const { doc } = parseContent({ format: 'markdown', body: md, url: URL })
    expect(doc.body.text).not.toContain('canonical')
  })

  it('渲染出 HTML 供投递使用', () => {
    const { renderedHtml } = parseContent({ format: 'markdown', body: md, url: URL })
    expect(renderedHtml).toContain('<h1>')
  })

  it('提取 Markdown 语法的标题、图片与链接', () => {
    const { doc } = parseContent({ format: 'markdown', body: md, url: URL })
    expect(doc.body.headings.map((h) => h.level)).toEqual([1, 2])
    expect(doc.body.images[0]).toEqual({ src: '/a.png', alt: '示意图' })
    expect(doc.body.links[0].internal).toBe(true)
  })

  it('缺失 frontmatter 时元数据为空，由规则报告缺失', () => {
    // 托管场景下 frontmatter 没写 title 就是真的没有 title，
    // 应当报 MISSING_TITLE，而不是跳过规则（ADR-001 §3）
    const bare = '# 只有标题\n\n正文内容。'
    const { doc } = parseContent({ format: 'markdown', body: bare, url: URL })
    expect(doc.head.title).toBeUndefined()
    expect(runRules(doc).issues.map((i) => i.code)).toContain('MISSING_TITLE')
  })
})

describe('HTML 与 Markdown 等价性', () => {
  // ADR-001 的核心主张：托管模式下两种格式能跑同一套规则并得到一致结论。
  // 若两者结论不同，第三方换个格式提交就能绕过门槛。
  it('等价内容的两种格式得到相同的问题集与分数', () => {
    const html = `<html lang="zh-CN"><head>
      <title>如何优化网站的搜索引擎排名完整指南</title>
      <meta name="description" content="本文详细介绍 SEO 优化的核心方法，涵盖标题、描述与内链建设等关键环节内容。">
      <link rel="canonical" href="https://example.com/article">
      <meta property="og:title" content="SEO">
      <meta property="og:description" content="指南">
      </head><body>
      <h1>如何优化网站的搜索引擎排名</h1>
      <p>${'正文内容。'.repeat(40)}</p>
      <img src="/a.png" alt="示意图">
      <a href="/x">链接一</a><a href="/y">链接二</a>
      </body></html>`

    const md = `---
title: 如何优化网站的搜索引擎排名完整指南
description: 本文详细介绍 SEO 优化的核心方法，涵盖标题、描述与内链建设等关键环节内容。
canonical: https://example.com/article
lang: zh-CN
og:
  title: SEO
  description: 指南
---

# 如何优化网站的搜索引擎排名

${'正文内容。'.repeat(40)}

![示意图](/a.png)

[链接一](/x) [链接二](/y)
`

    const htmlResult = runRules(parseContent({ format: 'html', body: html, url: URL }).doc)
    const mdResult = runRules(parseContent({ format: 'markdown', body: md, url: URL }).doc)

    expect(mdResult.issues.map((i) => i.code).sort()).toEqual(
      htmlResult.issues.map((i) => i.code).sort(),
    )
    expect(mdResult.score).toBe(htmlResult.score)
  })
})
