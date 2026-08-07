import { describe, expect, it } from 'vitest'
import { listRules } from './rules'
import { effortLabel, effortMinutes, prioritize, summarizeImpact } from './prioritize'
import type { Issue } from './types'

const WEIGHTS = Object.fromEntries(listRules().map((r) => [r.code, r.weight]))

function issue(code: string, severity: Issue['severity']): Issue {
  return { code, severity, message: 'm', evidence: 'e', recommendation: 'r' }
}

describe('修复耗时', () => {
  it('改一行元数据的规则耗时最短', () => {
    expect(effortMinutes('MISSING_LANG')).toBeLessThan(effortMinutes('MISSING_TITLE'))
  })

  it('写内容类规则耗时最长', () => {
    expect(effortMinutes('EMPTY_CONTENT')).toBeGreaterThan(effortMinutes('MISSING_CANONICAL'))
    expect(effortMinutes('THIN_CONTENT')).toBeGreaterThan(effortMinutes('TITLE_TOO_LONG'))
  })

  it('未知规则有兜底耗时，不会算出 0 导致除零', () => {
    expect(effortMinutes('UNKNOWN_RULE')).toBeGreaterThan(0)
  })

  it('按耗时分档', () => {
    expect(effortLabel(1)).toBe('quick')
    expect(effortLabel(10)).toBe('medium')
    expect(effortLabel(30)).toBe('heavy')
  })
})

describe('优先级排序', () => {
  it('critical 永远排在最前——它阻断发布', () => {
    // MISSING_LANG 性价比很高（3分/1分钟），但不阻断发布
    const r = prioritize({
      issues: [issue('MISSING_LANG', 'notice'), issue('MISSING_TITLE', 'critical')],
      weights: WEIGHTS,
    })
    expect(r[0].code).toBe('MISSING_TITLE')
    expect(r[0].blocking).toBe(true)
  })

  it('同级别按性价比排序，而非单纯按分值', () => {
    // THIN_CONTENT 权重 12 但要 25 分钟（0.48）；
    // MISSING_CANONICAL 权重 8 只要 1 分钟（8.0）——后者性价比高得多
    const r = prioritize({
      issues: [issue('THIN_CONTENT', 'warning'), issue('MISSING_CANONICAL', 'warning')],
      weights: WEIGHTS,
    })
    expect(r[0].code).toBe('MISSING_CANONICAL')
    expect(r[0].value).toBeGreaterThan(r[1].value)
  })

  it('性价比相同时先做省时的', () => {
    const weights = { A: 10, B: 20 }
    const r = prioritize({
      issues: [issue('B', 'warning'), issue('A', 'warning')],
      // 都是 10 分钟兜底 → A=1.0, B=2.0，B 应在前
      weights,
    })
    expect(r[0].code).toBe('B')
  })

  it('计算每条的分值增益与耗时', () => {
    const r = prioritize({ issues: [issue('MISSING_LANG', 'notice')], weights: WEIGHTS })
    expect(r[0].gain).toBe(3)
    expect(r[0].minutes).toBe(1)
    expect(r[0].effort).toBe('quick')
  })

  it('空列表返回空', () => {
    expect(prioritize({ issues: [], weights: WEIGHTS })).toEqual([])
  })

  it('多个 critical 之间仍按性价比排', () => {
    // NOINDEX 权重 40 且 1 分钟即可修；EMPTY_CONTENT 权重 30 要 30 分钟
    const r = prioritize({
      issues: [issue('EMPTY_CONTENT', 'critical'), issue('NOINDEX_DETECTED', 'critical')],
      weights: WEIGHTS,
    })
    expect(r[0].code).toBe('NOINDEX_DETECTED')
  })
})

describe('影响汇总', () => {
  it('算出全部修完可达的分数', () => {
    const p = prioritize({
      issues: [issue('MISSING_LANG', 'notice'), issue('MISSING_CANONICAL', 'warning')],
      weights: WEIGHTS,
    })
    const s = summarizeImpact(89, p)
    expect(s.potential).toBe(100) // 89 + 3 + 8 = 100
  })

  it('分数上限为 100，不会算出超过满分', () => {
    const p = prioritize({ issues: [issue('NOINDEX_DETECTED', 'critical')], weights: WEIGHTS })
    expect(summarizeImpact(95, p).potential).toBe(100)
  })

  it('单独算出 quick 项的收益与耗时——让用户看到「花几分钟能提多少」', () => {
    const p = prioritize({
      issues: [
        issue('MISSING_LANG', 'notice'), // 3 分 / 1 分钟 quick
        issue('THIN_CONTENT', 'warning'), // 12 分 / 25 分钟 heavy
      ],
      weights: WEIGHTS,
    })
    const s = summarizeImpact(80, p)
    expect(s.quickWin).toBe(83)
    expect(s.quickMinutes).toBe(1)
    expect(s.potential).toBe(95)
  })

  it('统计阻断发布的问题数', () => {
    const p = prioritize({
      issues: [issue('MISSING_TITLE', 'critical'), issue('MISSING_LANG', 'notice')],
      weights: WEIGHTS,
    })
    expect(summarizeImpact(50, p).blockingCount).toBe(1)
  })

  it('无问题时当前分即上限', () => {
    const s = summarizeImpact(100, [])
    expect(s.potential).toBe(100)
    expect(s.totalMinutes).toBe(0)
  })
})
