import { effortMinutes } from '@rankloop/seo-rules'

/**
 * 工作区级问题聚合。
 *
 * 面板要回答的是「团队下一步该做什么」，不是「什么问题最常见」。
 * 按出现次数排序会让一条出现 50 次、每次只值 1 分的 notice
 * 盖过一条只出现 3 次却阻断发布的 critical——次数多不等于值得先修。
 *
 * 排序口径与 prioritize.ts 保持一致：critical 置顶，其余按可挽回分数。
 * 两处若各排各的，同一批问题在概览页和详情页会给出矛盾的优先级。
 */

export interface IssueOccurrence {
  code: string
  severity: string
}

export interface AggregatedIssue {
  code: string
  severity: string
  /** 有多少个页面出现了这条问题 */
  count: number
  /** 全部修完能挽回的总分 */
  recoverable: number
  /** 全部修完的预估总耗时（分钟） */
  minutes: number
}

export function aggregateTopIssues(params: {
  checks: ReadonlyArray<{ issues: readonly IssueOccurrence[] }>
  weights: Record<string, number>
  limit?: number
}): AggregatedIssue[] {
  const byRule = new Map<string, AggregatedIssue>()

  for (const check of params.checks) {
    for (const issue of check.issues ?? []) {
      const entry = byRule.get(issue.code) ?? {
        code: issue.code,
        severity: issue.severity,
        count: 0,
        recoverable: 0,
        minutes: 0,
      }
      entry.count += 1
      // 每个受影响页面都要各修一次，分值与耗时都按出现次数累加
      entry.recoverable += params.weights[issue.code] ?? 0
      entry.minutes += effortMinutes(issue.code)
      byRule.set(issue.code, entry)
    }
  }

  return [...byRule.values()]
    .sort((a, b) => {
      // critical 永远在前：不修就发不出去，可挽回分数再高的 warning 也得让路
      const aBlocks = a.severity === 'critical'
      const bBlocks = b.severity === 'critical'
      if (aBlocks !== bBlocks) return aBlocks ? -1 : 1
      if (b.recoverable !== a.recoverable) return b.recoverable - a.recoverable
      // 分值相同时先做省时的
      return a.minutes - b.minutes
    })
    .slice(0, params.limit ?? 10)
}
