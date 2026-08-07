import { describe, expect, it } from 'vitest'
import { runRules } from './engine'
import type { SeoDocument } from './types'

/** 一份各项都合规的文档，测试用例基于它做单点劣化 */
function validDoc(overrides: Partial<SeoDocument> = {}): SeoDocument {
  return {
    url: 'https://example.com/article',
    head: {
      title: '如何优化网站的搜索引擎排名：完整指南',
      description:
        '本文详细介绍网站 SEO 优化的核心方法，涵盖标题、描述、结构化数据与内链建设等关键环节，帮助你系统提升搜索排名。',
      canonical: 'https://example.com/article',
      lang: 'zh-CN',
      openGraph: { title: 'SEO 指南', description: '完整指南', image: 'https://example.com/og.png' },
    },
    body: {
      headings: [
        { level: 1, text: '如何优化网站的搜索引擎排名' },
        { level: 2, text: '标题优化' },
      ],
      images: [{ src: '/a.png', alt: '示意图' }],
      links: [
        { href: '/other', internal: true },
        { href: '/third', internal: true },
        { href: 'https://external.com', internal: false },
      ],
      // 正文与标题同主题：真实页面如此。用无意义填充词会触发
      // TITLE_TOPIC_MISMATCH——那是规则在正确工作
      text: '优化网站的搜索引擎排名需要关注标题撰写与内链建设。'.repeat(30),
    },
    jsonLd: ['{"@context":"https://schema.org","@type":"Article"}'],
    statusCode: 200,
    ...overrides,
  }
}

/** 便捷断言：找出某规则编码对应的问题 */
function issueOf(doc: SeoDocument, code: string) {
  return runRules(doc).issues.find((i) => i.code === code)
}

describe('合规文档', () => {
  it('不应报告任何问题，且满分', () => {
    const result = runRules(validDoc())
    expect(result.issues).toEqual([])
    expect(result.score).toBe(100)
  })
})

describe('TITLE 规则', () => {
  // title 缺失会让搜索结果标题由引擎自行生成，失去关键词控制权
  it('缺失 title 判为 critical', () => {
    const doc = validDoc()
    doc.head.title = undefined
    const issue = issueOf(doc, 'MISSING_TITLE')
    expect(issue?.severity).toBe('critical')
    expect(issue?.recommendation).toBeTruthy()
  })

  // 过长标题会被搜索结果截断，尾部关键词失效
  it('title 过长判为 warning 并给出实际长度作为证据', () => {
    const doc = validDoc()
    doc.head.title = '标'.repeat(80)
    const issue = issueOf(doc, 'TITLE_TOO_LONG')
    expect(issue?.severity).toBe('warning')
    expect(issue?.evidence).toContain('80')
  })

  it('title 过短判为 warning', () => {
    const doc = validDoc()
    doc.head.title = '短'
    expect(issueOf(doc, 'TITLE_TOO_SHORT')?.severity).toBe('warning')
  })
})

describe('DESCRIPTION 规则', () => {
  it('缺失 description 判为 warning', () => {
    const doc = validDoc()
    doc.head.description = undefined
    expect(issueOf(doc, 'MISSING_DESCRIPTION')?.severity).toBe('warning')
  })
})

describe('H1 规则', () => {
  // 多个 H1 会稀释页面主题，搜索引擎难以判断核心内容
  it('多个 H1 判为 warning，证据包含数量', () => {
    const doc = validDoc()
    doc.body.headings = [
      { level: 1, text: '第一个' },
      { level: 1, text: '第二个' },
    ]
    const issue = issueOf(doc, 'MULTIPLE_H1')
    expect(issue?.severity).toBe('warning')
    expect(issue?.evidence).toContain('2')
  })

  it('缺失 H1 判为 warning', () => {
    const doc = validDoc()
    doc.body.headings = [{ level: 2, text: '只有 H2' }]
    expect(issueOf(doc, 'MISSING_H1')?.severity).toBe('warning')
  })
})

describe('NOINDEX 规则', () => {
  // 这是最危险的问题：页面完全不会进入索引，所有其他优化都白费
  it('robots 含 noindex 判为 critical', () => {
    const doc = validDoc()
    doc.head.robots = 'noindex, follow'
    expect(issueOf(doc, 'NOINDEX_DETECTED')?.severity).toBe('critical')
  })

  it('robots 为 index,follow 不报问题', () => {
    const doc = validDoc()
    doc.head.robots = 'index, follow'
    expect(issueOf(doc, 'NOINDEX_DETECTED')).toBeUndefined()
  })
})

describe('CANONICAL 规则', () => {
  it('canonical 指向其他域名判为 critical', () => {
    const doc = validDoc()
    doc.head.canonical = 'https://other-domain.com/article'
    expect(issueOf(doc, 'CANONICAL_CROSS_DOMAIN')?.severity).toBe('critical')
  })

  it('canonical 缺失判为 warning', () => {
    const doc = validDoc()
    doc.head.canonical = undefined
    expect(issueOf(doc, 'MISSING_CANONICAL')?.severity).toBe('warning')
  })

  it('canonical 为相对路径但指向自身，不应误报跨域', () => {
    const doc = validDoc()
    doc.head.canonical = '/article'
    expect(issueOf(doc, 'CANONICAL_CROSS_DOMAIN')).toBeUndefined()
  })
})

describe('图片 ALT 规则', () => {
  it('图片缺 alt 判为 warning，证据列出具体图片', () => {
    const doc = validDoc()
    doc.body.images = [{ src: '/no-alt.png' }]
    const issue = issueOf(doc, 'IMAGE_MISSING_ALT')
    expect(issue?.severity).toBe('warning')
    expect(issue?.evidence).toContain('/no-alt.png')
  })

  it('无图片时不报问题', () => {
    const doc = validDoc()
    doc.body.images = []
    expect(issueOf(doc, 'IMAGE_MISSING_ALT')).toBeUndefined()
  })
})

describe('结构化数据规则', () => {
  it('JSON-LD 解析失败判为 warning', () => {
    const doc = validDoc()
    doc.jsonLd = ['{ 这不是合法 JSON }']
    expect(issueOf(doc, 'INVALID_JSON_LD')?.severity).toBe('warning')
  })
})

describe('空页面规则', () => {
  it('正文过短判为 critical', () => {
    const doc = validDoc()
    doc.body.text = '太短'
    expect(issueOf(doc, 'EMPTY_CONTENT')?.severity).toBe('critical')
  })
})

describe('内链与语言规则', () => {
  it('内链过少判为 notice', () => {
    const doc = validDoc()
    doc.body.links = [{ href: 'https://external.com', internal: false }]
    expect(issueOf(doc, 'FEW_INTERNAL_LINKS')?.severity).toBe('notice')
  })

  it('缺少 lang 判为 notice', () => {
    const doc = validDoc()
    doc.head.lang = undefined
    expect(issueOf(doc, 'MISSING_LANG')?.severity).toBe('notice')
  })

  it('缺少 Open Graph 判为 notice', () => {
    const doc = validDoc()
    doc.head.openGraph = {}
    expect(issueOf(doc, 'MISSING_OPEN_GRAPH')?.severity).toBe('notice')
  })
})

describe('健康分', () => {
  // 分数必须可解释：由各规则权重累计扣除，而非黑盒（规格 §3.4）
  it('critical 问题的扣分显著高于 notice', () => {
    const criticalDoc = validDoc()
    criticalDoc.head.title = undefined

    const noticeDoc = validDoc()
    noticeDoc.head.lang = undefined

    expect(runRules(criticalDoc).score).toBeLessThan(runRules(noticeDoc).score)
  })

  it('分数下限为 0，不出现负分', () => {
    const doc: SeoDocument = {
      url: 'https://example.com/bad',
      head: {},
      body: { headings: [], images: [{ src: '/x.png' }], links: [], text: '' },
      jsonLd: ['{bad}'],
      statusCode: 500,
    }
    expect(runRules(doc).score).toBeGreaterThanOrEqual(0)
  })

  it('统计各级别问题数量', () => {
    const doc = validDoc()
    doc.head.title = undefined
    doc.head.lang = undefined
    const result = runRules(doc)
    expect(result.counts.critical).toBeGreaterThan(0)
    expect(result.counts.notice).toBeGreaterThan(0)
  })
})

describe('跳过规则（假阳性防护）', () => {
  // ADR-001 §3：信息不足时必须跳过并说明，绝不能报成问题。
  // 若把「无法判定」当成「违反」，会把第三方的 AI 引向错误的修复方向。
  it('statusCode 未知时跳过 5xx 规则，而非报告问题', () => {
    const doc = validDoc()
    doc.statusCode = undefined
    const result = runRules(doc)
    expect(result.issues.find((i) => i.code === 'SERVER_ERROR')).toBeUndefined()
    expect(result.skippedRules.map((s) => s.code)).toContain('SERVER_ERROR')
  })

  it('跳过的规则必须说明原因', () => {
    const doc = validDoc()
    doc.statusCode = undefined
    const skipped = runRules(doc).skippedRules.find((s) => s.code === 'SERVER_ERROR')
    expect(skipped?.reason).toBeTruthy()
  })

  it('跳过的规则不影响健康分', () => {
    const withStatus = validDoc()
    const withoutStatus = validDoc()
    withoutStatus.statusCode = undefined
    expect(runRules(withoutStatus).score).toBe(runRules(withStatus).score)
  })
})

describe('5xx 规则', () => {
  it('5xx 判为 critical', () => {
    const doc = validDoc()
    doc.statusCode = 503
    expect(issueOf(doc, 'SERVER_ERROR')?.severity).toBe('critical')
  })
})
