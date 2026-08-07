import { describe, expect, it } from 'vitest'
import { aggregateTopIssues } from './top-issues'

const weights = {
  MISSING_TITLE: 15,
  EMPTY_CONTENT: 20,
  MISSING_LANG: 3,
  MISSING_OG_IMAGE: 2,
  THIN_CONTENT: 12,
}

/** 造 n 个都含同一条问题的检测结果 */
function checks(code: string, severity: string, n: number, message?: string) {
  return Array.from({ length: n }, () => ({ issues: [{ code, severity, message }] }))
}

describe('人话说明', () => {
  it('透传规则给出的说明——面板要展示人话而非规则码', () => {
    const [e] = aggregateTopIssues({
      checks: checks('MISSING_TITLE', 'critical', 1, '页面缺少 title'),
      weights,
    })
    expect(e.message).toBe('页面缺少 title')
  })

  it('缺说明时退回规则码，而不是留空让面板显示空白', () => {
    const [e] = aggregateTopIssues({ checks: checks('MISSING_TITLE', 'critical', 1), weights })
    expect(e.message).toBe('MISSING_TITLE')
  })

  it('标记是否阻断发布——面板据此分组，这是两类性质不同的事', () => {
    const r = aggregateTopIssues({
      checks: [...checks('MISSING_TITLE', 'critical', 1), ...checks('MISSING_LANG', 'notice', 1)],
      weights,
    })
    expect(r.find((i) => i.code === 'MISSING_TITLE')?.blocking).toBe(true)
    expect(r.find((i) => i.code === 'MISSING_LANG')?.blocking).toBe(false)
  })
})

describe('工作区问题聚合', () => {
  it('阻断发布的问题排在高频小问题前面', () => {
    // 这是改排序的根本原因：出现 50 次的 notice 不该盖过 3 次的 critical，
    // 因为前者不影响发布，后者让 3 个页面根本发不出去。
    const result = aggregateTopIssues({
      checks: [
        ...checks('MISSING_OG_IMAGE', 'notice', 50),
        ...checks('MISSING_TITLE', 'critical', 3),
      ],
      weights,
    })

    expect(result[0].code).toBe('MISSING_TITLE')
    expect(result[0].count).toBe(3)
    // 高频 notice 的可挽回分数更高（100 > 45），仍然排在后面
    expect(result[1].code).toBe('MISSING_OG_IMAGE')
    expect(result[1].recoverable).toBeGreaterThan(result[0].recoverable)
  })

  it('同为非阻断问题时，按性价比排序而非出现次数', () => {
    const result = aggregateTopIssues({
      checks: [
        ...checks('MISSING_LANG', 'notice', 10), // 30 分 / 10 分钟 = 3.0
        ...checks('THIN_CONTENT', 'warning', 4), // 48 分 / 100 分钟 = 0.48
      ],
      weights,
    })

    // THIN_CONTENT 总分更高，但每分钟只挽回 0.48 分；
    // MISSING_LANG 10 分钟就能拿 30 分，应当先做
    expect(result.map((i) => i.code)).toEqual(['MISSING_LANG', 'THIN_CONTENT'])
  })

  it('总分高但耗时长的问题，排在省时高效的后面', () => {
    // 这是面板「按性价比排序」这句话的实际含义：
    // 补 9 条 canonical（9 分钟）比补 9 段描述（1.2 小时）先做
    const result = aggregateTopIssues({
      checks: [
        ...checks('MISSING_DESCRIPTION', 'warning', 9), // 90 分 / 72 分钟 = 1.25
        ...checks('MISSING_CANONICAL', 'warning', 9), // 72 分 / 9 分钟 = 8.0
      ],
      weights: { ...weights, MISSING_DESCRIPTION: 10, MISSING_CANONICAL: 8 },
    })

    expect(result[0].code).toBe('MISSING_CANONICAL')
  })

  it('分值与耗时按受影响页面数累加', () => {
    // 每个页面都要各修一次，不能只算一份成本
    const [entry] = aggregateTopIssues({
      checks: checks('MISSING_LANG', 'notice', 5),
      weights,
    })

    expect(entry.count).toBe(5)
    expect(entry.recoverable).toBe(15) // 5 × 3
    expect(entry.minutes).toBe(5) // MISSING_LANG 每处 1 分钟
  })

  it('多条 critical 之间按性价比排序——两者都阻断发布，先解开便宜的那个', () => {
    const result = aggregateTopIssues({
      checks: [
        ...checks('MISSING_TITLE', 'critical', 1), // 15 分 / 8 分钟 = 1.88
        ...checks('EMPTY_CONTENT', 'critical', 1), // 20 分 / 30 分钟 = 0.67
      ],
      weights,
    })

    // 补标题 8 分钟就能解阻断，写正文要 30 分钟，先做前者
    expect(result.map((i) => i.code)).toEqual(['MISSING_TITLE', 'EMPTY_CONTENT'])
  })

  it('可挽回分数相同时先做省时的', () => {
    // MISSING_OG_IMAGE 2 分/2 分钟 ×3 = 6 分/6 分钟
    // MISSING_LANG    3 分/1 分钟 ×2 = 6 分/2 分钟
    const result = aggregateTopIssues({
      checks: [
        ...checks('MISSING_OG_IMAGE', 'notice', 3),
        ...checks('MISSING_LANG', 'notice', 2),
      ],
      weights,
    })

    expect(result[0].recoverable).toBe(result[1].recoverable)
    expect(result[0].code).toBe('MISSING_LANG')
  })

  it('未知规则编码按 0 分计，不会因缺权重而崩', () => {
    // 规则表升级后旧检测结果里可能残留已删除的编码
    const [entry] = aggregateTopIssues({
      checks: checks('REMOVED_RULE', 'notice', 2),
      weights,
    })

    expect(entry.recoverable).toBe(0)
    expect(entry.count).toBe(2)
  })

  it('无问题时返回空数组', () => {
    expect(aggregateTopIssues({ checks: [{ issues: [] }], weights })).toEqual([])
  })

  it('按 limit 截断', () => {
    const result = aggregateTopIssues({
      checks: [
        ...checks('MISSING_TITLE', 'critical', 1),
        ...checks('EMPTY_CONTENT', 'critical', 1),
        ...checks('THIN_CONTENT', 'warning', 1),
      ],
      weights,
      limit: 2,
    })

    expect(result).toHaveLength(2)
  })
})
