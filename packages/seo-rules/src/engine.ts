import { RULES_VERSION, rules } from './rules'
import { type CheckResult, type Issue, type SeoDocument, type SkippedRule, isSkipped } from './types'

/**
 * 对文档执行全部规则。
 *
 * 健康分从 100 起，按违反规则的权重扣除，下限 0。
 * 分数必须可解释——每一分的扣除都能追溯到具体规则（规格 §3.4）。
 * 被跳过的规则不参与扣分，避免「信息不足」被当作「不合格」。
 */
export function runRules(doc: SeoDocument): CheckResult {
  const issues: Issue[] = []
  const skippedRules: SkippedRule[] = []
  let deduction = 0

  for (const rule of rules) {
    const outcome = rule.evaluate(doc)
    if (outcome === null) continue

    if (isSkipped(outcome)) {
      skippedRules.push(outcome)
      continue
    }

    issues.push({ code: rule.code, severity: rule.severity, ...outcome })
    deduction += rule.weight
  }

  const counts = {
    critical: issues.filter((i) => i.severity === 'critical').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    notice: issues.filter((i) => i.severity === 'notice').length,
  }

  return {
    score: Math.max(0, 100 - deduction),
    issues,
    skippedRules,
    counts,
    rulesVersion: RULES_VERSION,
  }
}

export { RULES_VERSION, listRules } from './rules'
export { parseContent, type ParseInput, type ParsedContent } from './parse'
export {
  prioritize,
  summarizeImpact,
  effortMinutes,
  effortLabel,
  type PrioritizedIssue,
  type ImpactSummary,
  type Effort,
} from './prioritize'
export * from './types'
