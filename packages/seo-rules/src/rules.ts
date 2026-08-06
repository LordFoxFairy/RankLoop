import type { Rule, SeoDocument } from './types'

/**
 * SEO 规则集。
 *
 * 每条规则必须：
 * 1. 信息不足时返回 SkippedRule，绝不猜测（避免假阳性误导第三方的自动优化）；
 * 2. 提供可定位的证据；
 * 3. 提供明确可执行的修复建议。
 */

const TITLE_MIN = 10
const TITLE_MAX = 60
const DESCRIPTION_MIN = 50
const CONTENT_MIN_CHARS = 100
const MIN_INTERNAL_LINKS = 2

/** 取 canonical 的绝对形式，无法解析时返回 null */
function resolveCanonical(canonical: string, pageUrl: string): URL | null {
  try {
    return new URL(canonical, pageUrl)
  } catch {
    return null
  }
}

export const rules: Rule[] = [
  {
    code: 'SERVER_ERROR',
    severity: 'critical',
    weight: 40,
    evaluate(doc) {
      if (doc.statusCode === undefined) {
        return { code: 'SERVER_ERROR', reason: '输入未提供 HTTP 状态码，无法判定服务端错误' }
      }
      if (doc.statusCode < 500) return null
      return {
        message: '页面返回服务端错误，搜索引擎无法抓取',
        evidence: `HTTP ${doc.statusCode}`,
        recommendation: '修复服务端错误，确保页面稳定返回 200。',
      }
    },
  },
  {
    code: 'NOINDEX_DETECTED',
    severity: 'critical',
    weight: 40,
    evaluate(doc) {
      const robots = doc.head.robots?.toLowerCase()
      if (!robots || !robots.includes('noindex')) return null
      return {
        message: '页面被标记为 noindex，不会被搜索引擎收录',
        evidence: `robots: ${doc.head.robots}`,
        recommendation: '若该页面需要被收录，移除 robots meta 中的 noindex。',
      }
    },
  },
  {
    code: 'MISSING_TITLE',
    severity: 'critical',
    weight: 30,
    evaluate(doc) {
      if (doc.head.title?.trim()) return null
      return {
        message: '页面缺少 title',
        evidence: 'title 为空或未提供',
        recommendation: `添加 ${TITLE_MIN}-${TITLE_MAX} 字符的标题，包含核心关键词。`,
      }
    },
  },
  {
    code: 'EMPTY_CONTENT',
    severity: 'critical',
    weight: 30,
    evaluate(doc) {
      const len = doc.body.text.trim().length
      if (len >= CONTENT_MIN_CHARS) return null
      return {
        message: '页面正文过少，疑似空页面',
        evidence: `正文仅 ${len} 字符`,
        recommendation: `补充实质内容，正文至少 ${CONTENT_MIN_CHARS} 字符。`,
      }
    },
  },
  {
    code: 'CANONICAL_CROSS_DOMAIN',
    severity: 'critical',
    weight: 25,
    evaluate(doc) {
      const { canonical } = doc.head
      if (!canonical) return null
      const resolved = resolveCanonical(canonical, doc.url)
      if (!resolved) {
        return {
          message: 'canonical 不是合法 URL',
          evidence: `canonical: ${canonical}`,
          recommendation: '修正 canonical 为合法的绝对或相对 URL。',
        }
      }
      let pageHost: string
      try {
        pageHost = new URL(doc.url).host
      } catch {
        return { code: 'CANONICAL_CROSS_DOMAIN', reason: '页面 URL 非法，无法比对 canonical 域名' }
      }
      if (resolved.host === pageHost) return null
      return {
        message: 'canonical 指向其他域名，本页面的权重会被转移',
        evidence: `canonical 指向 ${resolved.host}，页面位于 ${pageHost}`,
        recommendation: '将 canonical 指向本页面自身，除非确实需要跨域归并。',
      }
    },
  },
  {
    code: 'TITLE_TOO_LONG',
    severity: 'warning',
    weight: 10,
    evaluate(doc) {
      const title = doc.head.title?.trim()
      if (!title || title.length <= TITLE_MAX) return null
      return {
        message: '标题过长，搜索结果中会被截断',
        evidence: `标题长度 ${title.length} 字符，建议不超过 ${TITLE_MAX}`,
        recommendation: `压缩到 ${TITLE_MAX} 字符以内，把关键词前置。`,
      }
    },
  },
  {
    code: 'TITLE_TOO_SHORT',
    severity: 'warning',
    weight: 10,
    evaluate(doc) {
      const title = doc.head.title?.trim()
      if (!title || title.length >= TITLE_MIN) return null
      return {
        message: '标题过短，无法充分表达页面主题',
        evidence: `标题长度 ${title.length} 字符，建议不少于 ${TITLE_MIN}`,
        recommendation: `扩展到 ${TITLE_MIN}-${TITLE_MAX} 字符，包含核心关键词。`,
      }
    },
  },
  {
    code: 'MISSING_DESCRIPTION',
    severity: 'warning',
    weight: 10,
    evaluate(doc) {
      const desc = doc.head.description?.trim()
      if (desc && desc.length >= DESCRIPTION_MIN) return null
      return {
        message: desc ? 'description 过短' : '页面缺少 description',
        evidence: desc ? `description 长度 ${desc.length} 字符` : 'description 未提供',
        recommendation: `补充 ${DESCRIPTION_MIN}-160 字符的描述，概括页面内容并包含关键词。`,
      }
    },
  },
  {
    code: 'MISSING_H1',
    severity: 'warning',
    weight: 10,
    evaluate(doc) {
      if (doc.body.headings.some((h) => h.level === 1)) return null
      return {
        message: '页面缺少 H1 标题',
        evidence: `共 ${doc.body.headings.length} 个标题，无 H1`,
        recommendation: '添加唯一的 H1，表达页面核心主题。',
      }
    },
  },
  {
    code: 'MULTIPLE_H1',
    severity: 'warning',
    weight: 8,
    evaluate(doc) {
      const h1s = doc.body.headings.filter((h) => h.level === 1)
      if (h1s.length <= 1) return null
      return {
        message: '页面存在多个 H1，主题被稀释',
        evidence: `共 ${h1s.length} 个 H1：${h1s.map((h) => h.text).join(' / ')}`,
        recommendation: '只保留一个 H1，其余降级为 H2。',
      }
    },
  },
  {
    code: 'MISSING_CANONICAL',
    severity: 'warning',
    weight: 8,
    evaluate(doc) {
      if (doc.head.canonical) return null
      return {
        message: '页面缺少 canonical',
        evidence: 'canonical 未提供',
        recommendation: '添加指向页面自身的 canonical，避免重复内容被分散计权。',
      }
    },
  },
  {
    code: 'IMAGE_MISSING_ALT',
    severity: 'warning',
    weight: 8,
    evaluate(doc) {
      const missing = doc.body.images.filter((img) => !img.alt?.trim())
      if (missing.length === 0) return null
      return {
        message: '存在缺少 alt 属性的图片',
        evidence: `${missing.length} 张图片缺少 alt：${missing.map((i) => i.src).join(', ')}`,
        recommendation: '为每张图片补充描述性 alt，兼顾可访问性与图片搜索。',
      }
    },
  },
  {
    code: 'INVALID_JSON_LD',
    severity: 'warning',
    weight: 8,
    evaluate(doc) {
      if (!doc.jsonLd || doc.jsonLd.length === 0) return null
      const bad = doc.jsonLd.filter((raw) => {
        try {
          JSON.parse(raw)
          return false
        } catch {
          return true
        }
      })
      if (bad.length === 0) return null
      return {
        message: '结构化数据 JSON 解析失败，搜索引擎会忽略',
        evidence: `${bad.length} 段 JSON-LD 无法解析，首段：${bad[0].slice(0, 80)}`,
        recommendation: '修正 JSON-LD 语法，可用 Google 富媒体测试工具校验。',
      }
    },
  },
  {
    code: 'FEW_INTERNAL_LINKS',
    severity: 'notice',
    weight: 3,
    evaluate(doc) {
      const internal = doc.body.links.filter((l) => l.internal)
      if (internal.length >= MIN_INTERNAL_LINKS) return null
      return {
        message: '内链数量偏少，不利于权重传递与爬取发现',
        evidence: `仅 ${internal.length} 条内链`,
        recommendation: `增加到至少 ${MIN_INTERNAL_LINKS} 条指向站内相关页面的链接。`,
      }
    },
  },
  {
    code: 'MISSING_LANG',
    severity: 'notice',
    weight: 3,
    evaluate(doc) {
      if (doc.head.lang?.trim()) return null
      return {
        message: '页面未声明语言',
        evidence: 'lang 属性未提供',
        recommendation: '在 html 标签上声明 lang，如 zh-CN。',
      }
    },
  },
  {
    code: 'MISSING_OPEN_GRAPH',
    severity: 'notice',
    weight: 3,
    evaluate(doc) {
      const og = doc.head.openGraph ?? {}
      if (og.title && og.description) return null
      return {
        message: '缺少 Open Graph 基础字段，社交分享展示效果差',
        evidence: `已有字段：${Object.keys(og).join(', ') || '无'}`,
        recommendation: '补充 og:title、og:description、og:image。',
      }
    },
  },
]

export const RULES_VERSION = '1.0.0'

/** 供 API 文档与第三方查询：返回规则清单及其含义 */
export function listRules(): Array<Pick<Rule, 'code' | 'severity' | 'weight'>> {
  return rules.map(({ code, severity, weight }) => ({ code, severity, weight }))
}

export type { SeoDocument }
