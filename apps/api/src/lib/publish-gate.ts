import { type CheckResult, parseContent, runRules } from '@rankloop/seo-rules'

/**
 * 发布门槛（ADR-001 §4）。
 *
 * critical 问题存在时拒绝发布；warning / notice 仅提示不阻塞。
 * 门槛判定与内容存储解耦，因此提交、更新、发布三个动作可以复用同一份检测逻辑。
 */

export interface GateResult {
  check: CheckResult
  allowed: boolean
  /** 阻塞发布的规则编码，供 422 响应体使用 */
  blocking: string[]
}

export function checkContent(params: {
  format: 'html' | 'markdown'
  body: string
  url: string
}): GateResult & { metadata: Record<string, unknown>; renderedHtml?: string } {
  const { doc, metadata, renderedHtml } = parseContent(params)
  const check = runRules(doc)
  const blocking = check.issues.filter((i) => i.severity === 'critical').map((i) => i.code)

  return { check, allowed: blocking.length === 0, blocking, metadata, renderedHtml }
}
