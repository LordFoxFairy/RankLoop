import { describe, expect, it } from 'vitest'
import { runRules } from './engine'
import type { SeoDocument } from './types'

function doc(overrides: Partial<SeoDocument> = {}): SeoDocument {
  return {
    url: 'https://example.com/article',
    head: {
      title: '如何优化网站的搜索引擎排名完整指南',
      description:
        '本文详细介绍网站 SEO 优化的核心方法，涵盖标题撰写、描述优化、结构化数据标记与内链建设等关键环节的实操内容。',
      canonical: 'https://example.com/article',
      lang: 'zh-CN',
      openGraph: { title: 'SEO', description: '指南', image: 'https://example.com/og.png' },
    },
    body: {
      headings: [
        { level: 1, text: '如何优化网站的搜索引擎排名' },
        { level: 2, text: '标题优化' },
      ],
      images: [{ src: '/a.png', alt: '示意图' }],
      links: [
        { href: '/x', internal: true, text: 'SEO 优化指南' },
        { href: '/y', internal: true, text: '关键词研究方法' },
      ],
      text: '正文内容详细说明。'.repeat(60),
    },
    jsonLd: ['{"@type":"Article"}'],
    statusCode: 200,
    ...overrides,
  }
}

function issue(d: SeoDocument, code: string) {
  return runRules(d).issues.find((i) => i.code === code)
}

function skipped(d: SeoDocument, code: string) {
  return runRules(d).skippedRules.find((s) => s.code === code)
}

describe('描述长度', () => {
  it('过长判为 warning', () => {
    const d = doc()
    d.head.description = '描'.repeat(200)
    expect(issue(d, 'DESCRIPTION_TOO_LONG')?.severity).toBe('warning')
  })

  it('正常长度不报', () => {
    expect(issue(doc(), 'DESCRIPTION_TOO_LONG')).toBeUndefined()
  })
})

describe('内容厚度', () => {
  it('内容偏薄判为 warning', () => {
    const d = doc()
    d.body.text = '较短的正文内容。'.repeat(12)
    expect(issue(d, 'THIN_CONTENT')?.severity).toBe('warning')
  })

  it('充足内容不报', () => {
    expect(issue(doc(), 'THIN_CONTENT')).toBeUndefined()
  })

  it('完全空的正文交由 EMPTY_CONTENT 处理，不重复报 THIN_CONTENT', () => {
    // 两条规则都报会让第三方看到重复信号，不知道该修哪个
    const d = doc()
    d.body.text = ''
    expect(issue(d, 'EMPTY_CONTENT')).toBeDefined()
    expect(issue(d, 'THIN_CONTENT')).toBeUndefined()
  })
})

describe('标题与 H1 相关性', () => {
  it('主题不一致时判为 notice', () => {
    const d = doc()
    d.head.title = '完全无关的其他主题内容标题'
    d.body.headings = [{ level: 1, text: '猫咪养护指南' }]
    expect(issue(d, 'TITLE_H1_MISMATCH')?.severity).toBe('notice')
  })

  it('主题一致时不报', () => {
    expect(issue(doc(), 'TITLE_H1_MISMATCH')).toBeUndefined()
  })

  it('缺少 H1 时跳过而非误报', () => {
    // 缺 H1 由 MISSING_H1 负责，这里信息不足应跳过
    const d = doc()
    d.body.headings = [{ level: 2, text: 'x' }]
    expect(issue(d, 'TITLE_H1_MISMATCH')).toBeUndefined()
    expect(skipped(d, 'TITLE_H1_MISMATCH')).toBeDefined()
  })
})

describe('标题层级', () => {
  it('跳级判为 notice', () => {
    const d = doc()
    d.body.headings = [
      { level: 1, text: 'a' },
      { level: 4, text: 'b' },
    ]
    expect(issue(d, 'HEADING_HIERARCHY_SKIP')?.severity).toBe('notice')
  })

  it('逐级递进不报', () => {
    expect(issue(doc(), 'HEADING_HIERARCHY_SKIP')).toBeUndefined()
  })

  it('层级回退不算跳级', () => {
    const d = doc()
    d.body.headings = [
      { level: 1, text: 'a' },
      { level: 2, text: 'b' },
      { level: 1, text: 'c' },
    ]
    expect(issue(d, 'HEADING_HIERARCHY_SKIP')).toBeUndefined()
  })
})

describe('锚文本描述性', () => {
  it('无意义锚文本判为 notice', () => {
    const d = doc()
    d.body.links = [
      { href: '/x', internal: true, text: '点击这里' },
      { href: '/y', internal: true, text: '查看更多' },
    ]
    const found = issue(d, 'NON_DESCRIPTIVE_LINK_TEXT')
    expect(found?.severity).toBe('notice')
    expect(found?.evidence).toContain('点击这里')
  })

  it('英文无意义锚文本同样识别', () => {
    const d = doc()
    d.body.links = [{ href: '/x', internal: true, text: 'click here' }]
    expect(issue(d, 'NON_DESCRIPTIVE_LINK_TEXT')).toBeDefined()
  })

  it('描述性锚文本不报', () => {
    expect(issue(doc(), 'NON_DESCRIPTIVE_LINK_TEXT')).toBeUndefined()
  })

  it('无链接文本时跳过而非误报', () => {
    const d = doc()
    d.body.links = [{ href: '/x', internal: true }]
    expect(issue(d, 'NON_DESCRIPTIVE_LINK_TEXT')).toBeUndefined()
    expect(skipped(d, 'NON_DESCRIPTIVE_LINK_TEXT')).toBeDefined()
  })
})

describe('URL 长度', () => {
  it('过长判为 notice', () => {
    const d = doc({ url: `https://example.com/${'a'.repeat(150)}` })
    expect(issue(d, 'URL_TOO_LONG')?.severity).toBe('notice')
  })

  it('正常长度不报', () => {
    expect(issue(doc(), 'URL_TOO_LONG')).toBeUndefined()
  })
})

describe('Open Graph 图片', () => {
  it('缺 og:image 判为 notice', () => {
    const d = doc()
    d.head.openGraph = { title: 'a', description: 'b' }
    expect(issue(d, 'MISSING_OG_IMAGE')?.severity).toBe('notice')
  })
})

describe('alt 长度', () => {
  it('过长判为 notice', () => {
    const d = doc()
    d.body.images = [{ src: '/a.png', alt: '描'.repeat(200) }]
    expect(issue(d, 'IMAGE_ALT_TOO_LONG')?.severity).toBe('notice')
  })
})

describe('扩展规则的整体约束', () => {
  it('完全合规的文档仍得满分', () => {
    const result = runRules(doc())
    expect(result.issues).toEqual([])
    expect(result.score).toBe(100)
  })

  it('所有扩展规则都提供证据与修复建议', () => {
    const bad: SeoDocument = {
      url: `https://example.com/${'x'.repeat(150)}`,
      head: { title: '短', description: '描'.repeat(200), openGraph: {} },
      body: {
        headings: [
          { level: 1, text: '猫' },
          { level: 5, text: 'x' },
        ],
        images: [{ src: '/a.png', alt: '描'.repeat(200) }],
        links: [{ href: '/x', internal: true, text: '点击这里' }],
        text: '短文本。'.repeat(10),
      },
      statusCode: 200,
    }
    for (const i of runRules(bad).issues) {
      expect(i.evidence, `${i.code} 缺少证据`).toBeTruthy()
      expect(i.recommendation, `${i.code} 缺少修复建议`).toBeTruthy()
    }
  })
})

describe('MISSING_STRUCTURED_DATA', () => {
  it('没有 JSON-LD 时提示——拿不到富媒体摘要会损失点击率', () => {
    const issues = runRules(doc({ jsonLd: [] })).issues
    expect(issues.find((i) => i.code === 'MISSING_STRUCTURED_DATA')).toBeTruthy()
  })

  it('有结构化数据时不提示', () => {
    const issues = runRules(
      doc({ jsonLd: ['{"@context":"https://schema.org","@type":"Article"}'] }),
    ).issues
    expect(issues.find((i) => i.code === 'MISSING_STRUCTURED_DATA')).toBeUndefined()
  })

  it('不阻断发布——没有结构化数据照样能被收录', () => {
    const issue = runRules(doc({ jsonLd: [] })).issues.find(
      (i) => i.code === 'MISSING_STRUCTURED_DATA',
    )
    expect(issue?.severity).toBe('notice')
  })

  it('与 INVALID_JSON_LD 互斥——语法错误时不重复报缺失', () => {
    const issues = runRules(doc({ jsonLd: ['{bad json'] })).issues
    expect(issues.find((i) => i.code === 'INVALID_JSON_LD')).toBeTruthy()
    expect(issues.find((i) => i.code === 'MISSING_STRUCTURED_DATA')).toBeUndefined()
  })
})
