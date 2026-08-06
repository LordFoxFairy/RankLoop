import type { CheckResult, Issue, Severity, SkippedRule } from '@rankloop/seo-rules'

/**
 * SEO 检测结果值对象。
 *
 * 不可变、无标识、按值相等。检测结果一旦产生就是事实快照——
 * 「某版本在某规则版本下的结论」，不应被修改。
 */
export class SeoCheck {
  private constructor(
    readonly score: number,
    readonly issues: readonly Issue[],
    readonly skippedRules: readonly SkippedRule[],
    readonly rulesVersion: string,
  ) {
    Object.freeze(this)
  }

  static fromResult(result: CheckResult): SeoCheck {
    return new SeoCheck(
      result.score,
      Object.freeze([...result.issues]),
      Object.freeze([...result.skippedRules]),
      result.rulesVersion,
    )
  }

  static restore(params: {
    score: number
    issues: Issue[]
    skippedRules: SkippedRule[]
    rulesVersion: string
  }): SeoCheck {
    return new SeoCheck(
      params.score,
      Object.freeze([...params.issues]),
      Object.freeze([...params.skippedRules]),
      params.rulesVersion,
    )
  }

  countOf(severity: Severity): number {
    return this.issues.filter((i) => i.severity === severity).length
  }

  get counts(): Record<Severity, number> {
    return {
      critical: this.countOf('critical'),
      warning: this.countOf('warning'),
      notice: this.countOf('notice'),
    }
  }

  /** 阻塞发布的规则编码。critical 即阻塞（ADR-001 §4） */
  get blockingRules(): readonly string[] {
    return this.issues.filter((i) => i.severity === 'critical').map((i) => i.code)
  }

  get passesGate(): boolean {
    return this.blockingRules.length === 0
  }

  equals(other: SeoCheck): boolean {
    return (
      this.score === other.score &&
      this.rulesVersion === other.rulesVersion &&
      this.issues.length === other.issues.length &&
      this.issues.every((i, idx) => i.code === other.issues[idx]?.code)
    )
  }
}
