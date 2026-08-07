import type { Issue, Severity } from './types'

/**
 * 优化建议排序。
 *
 * 一堆问题不等于知道先做哪个。权重只说明「修好能加多少分」，
 * 但修复成本差异极大——补 lang 属性 30 秒加 3 分，
 * 补 300 字正文 20 分钟加 12 分。真正有用的排序是性价比。
 *
 * 排序依据：分值增益 ÷ 预估耗时，critical 强制置顶（它阻断发布）。
 */

export type Effort = 'quick' | 'medium' | 'heavy'

/** 各规则的预估修复耗时（分钟）。依据是「需要人做什么」而非代码复杂度。 */
const EFFORT_MINUTES: Record<string, number> = {
  // 改一行元数据即可
  MISSING_LANG: 1,
  MISSING_CANONICAL: 1,
  NOINDEX_DETECTED: 1,
  MISSING_OG_IMAGE: 2,
  MISSING_OPEN_GRAPH: 3,
  URL_TOO_LONG: 3,
  CANONICAL_CROSS_DOMAIN: 3,
  // 需要斟酌文案
  TITLE_TOO_LONG: 5,
  TITLE_TOO_SHORT: 5,
  MISSING_TITLE: 8,
  DESCRIPTION_TOO_LONG: 5,
  MISSING_DESCRIPTION: 8,
  MISSING_H1: 5,
  MULTIPLE_H1: 5,
  TITLE_H1_MISMATCH: 8,
  HEADING_HIERARCHY_SKIP: 6,
  IMAGE_ALT_TOO_LONG: 5,
  NON_DESCRIPTIVE_LINK_TEXT: 6,
  // 需要逐项处理或写内容
  IMAGE_MISSING_ALT: 10,
  INVALID_JSON_LD: 10,
  // 从零写一段 schema.org 标记比修语法错误更费时
  MISSING_STRUCTURED_DATA: 15,
  // 改标题或调整开头段落，需要斟酌措辞
  TITLE_TOPIC_MISMATCH: 10,
  // 要先找到合适的权威来源
  NO_EXTERNAL_REFERENCES: 12,
  FEW_INTERNAL_LINKS: 12,
  THIN_CONTENT: 25,
  EMPTY_CONTENT: 30,
  // 需要改服务端
  SERVER_ERROR: 20,
}

const DEFAULT_MINUTES = 10

export function effortMinutes(code: string): number {
  return EFFORT_MINUTES[code] ?? DEFAULT_MINUTES
}

export function effortLabel(minutes: number): Effort {
  if (minutes <= 5) return 'quick'
  if (minutes <= 12) return 'medium'
  return 'heavy'
}

export interface PrioritizedIssue extends Issue {
  /** 修好这条能加回的分数 */
  gain: number
  /** 预估耗时（分钟） */
  minutes: number
  effort: Effort
  /** 是否阻断发布 */
  blocking: boolean
  /** 性价比：每分钟能挽回的分数，用于排序 */
  value: number
}

export interface PrioritizeInput {
  issues: readonly Issue[]
  /** 规则权重表，来自 listRules() */
  weights: Record<string, number>
}

/**
 * 按性价比排序，critical 置顶。
 *
 * critical 不参与性价比比较——它阻断发布，无论多贵都必须先做。
 */
export function prioritize(input: PrioritizeInput): PrioritizedIssue[] {
  const items = input.issues.map((issue): PrioritizedIssue => {
    const gain = input.weights[issue.code] ?? 0
    const minutes = effortMinutes(issue.code)
    return {
      ...issue,
      gain,
      minutes,
      effort: effortLabel(minutes),
      blocking: issue.severity === 'critical',
      value: minutes > 0 ? Number((gain / minutes).toFixed(3)) : gain,
    }
  })

  return items.sort((a, b) => {
    // critical 永远在前：不修就发不出去，性价比再高的 warning 也得让路
    if (a.blocking !== b.blocking) return a.blocking ? -1 : 1
    if (b.value !== a.value) return b.value - a.value
    // 性价比相同时，先做省时的——快速见效更利于推进
    return a.minutes - b.minutes
  })
}

export interface ImpactSummary {
  /** 当前分数 */
  current: number
  /** 全部修完可达的分数 */
  potential: number
  /** 只做 quick 项可达的分数 */
  quickWin: number
  /** quick 项总耗时 */
  quickMinutes: number
  /** 阻断发布的问题数 */
  blockingCount: number
  /** 全部修完总耗时 */
  totalMinutes: number
}

/** 汇总：让用户看到「花 10 分钟能提多少分」 */
export function summarizeImpact(
  score: number,
  prioritized: readonly PrioritizedIssue[],
): ImpactSummary {
  const quick = prioritized.filter((i) => i.effort === 'quick')
  const totalGain = prioritized.reduce((s, i) => s + i.gain, 0)
  const quickGain = quick.reduce((s, i) => s + i.gain, 0)

  return {
    current: score,
    // 分数上限 100，全修完不会超过
    potential: Math.min(100, score + totalGain),
    quickWin: Math.min(100, score + quickGain),
    quickMinutes: quick.reduce((s, i) => s + i.minutes, 0),
    blockingCount: prioritized.filter((i) => i.blocking).length,
    totalMinutes: prioritized.reduce((s, i) => s + i.minutes, 0),
  }
}

export type { Issue, Severity }
