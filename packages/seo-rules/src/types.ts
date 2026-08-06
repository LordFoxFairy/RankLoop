/**
 * SEO 规则引擎类型定义。
 *
 * 设计约束（ADR-001 §6）：规则引擎必须「输入无关」——只接收已解析的文档模型，
 * 不关心内容来自托管提交还是二期的爬虫抓取。因此这里不出现任何 HTTP、
 * 数据库或 Markdown 相关的类型。
 */

export type Severity = 'critical' | 'warning' | 'notice'

/** 规则引擎的输入：一份已解析的文档 */
export interface SeoDocument {
  /** 页面最终 URL；托管内容为投递后的绝对地址 */
  url: string
  /** 已提取的 <head> 元数据 */
  head: {
    title?: string
    description?: string
    canonical?: string
    robots?: string
    lang?: string
    openGraph?: Record<string, string>
  }
  /** 正文结构 */
  body: {
    headings: Array<{ level: number; text: string }>
    images: Array<{ src: string; alt?: string }>
    links: Array<{ href: string; internal: boolean }>
    /** 纯文本正文，用于长度与空页面判定 */
    text: string
  }
  /** 结构化数据原始字符串，解析失败也要保留以便报错 */
  jsonLd?: string[]
  /** HTTP 状态码。托管内容恒为 200；爬虫场景填真实状态码 */
  statusCode?: number
}

/** 某条规则因输入缺少必要信息而无法判定 */
export interface SkippedRule {
  code: string
  reason: string
}

export interface Issue {
  code: string
  severity: Severity
  message: string
  /** 证据：触发该规则的具体内容，便于第三方定位 */
  evidence: string
  /** 明确的修复建议（规格 §3.4 要求） */
  recommendation: string
}

export interface Rule {
  code: string
  severity: Severity
  /** 健康分权重；分数由权重累计扣除，可解释（规格 §3.4） */
  weight: number
  /**
   * 判定文档是否违反本规则。
   * 返回 null 表示通过；返回 SkippedRule 表示信息不足无法判定
   * （绝不能因信息不足而报告问题——那是假阳性，见 §0 第 10 条）。
   */
  evaluate(doc: SeoDocument): Omit<Issue, 'code' | 'severity'> | SkippedRule | null
}

export interface CheckResult {
  score: number
  issues: Issue[]
  skippedRules: SkippedRule[]
  counts: { critical: number; warning: number; notice: number }
  rulesVersion: string
}

export function isSkipped(
  r: Omit<Issue, 'code' | 'severity'> | SkippedRule | null,
): r is SkippedRule {
  return r !== null && 'reason' in r
}
