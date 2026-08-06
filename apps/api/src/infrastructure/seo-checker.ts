import { type ContentChecker, SeoCheck } from '../domain/content'
import { parseContent, runRules } from '@rankloop/seo-rules'

/**
 * 基础设施层：把规则引擎适配成领域层定义的 ContentChecker 端口。
 *
 * 领域层只知道「有个东西能检测内容」，解析 HTML/Markdown 与跑规则的细节在这里。
 */
export const seoChecker: ContentChecker = {
  check({ format, body, url }) {
    const { doc, metadata } = parseContent({ format, body, url })
    return { check: SeoCheck.fromResult(runRules(doc)), metadata }
  },
}
