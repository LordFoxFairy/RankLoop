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
function checks(code: string, severity: string, n: number) {
  return Array.from({ length: n }, () => ({ issues: [{ code, severity }] }))
}

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

  it('同为非阻断问题时，按可挽回分数排序而非出现次数', () => {
    const result = aggregateTopIssues({
      checks: [
        ...checks('MISSING_LANG', 'notice', 10), // 10 × 3 = 30 分
        ...checks('THIN_CONTENT', 'warning', 4), // 4 × 12 = 48 分
      ],
      weights,
    })

    // THIN_CONTENT 出现次数少，但修完能多挽回 18 分，应当先做
    expect(result.map((i) => i.code)).toEqual(['THIN_CONTENT', 'MISSING_LANG'])
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

  it('多条 critical 之间仍按可挽回分数排序', () => {
    const result = aggregateTopIssues({
      checks: [
        ...checks('MISSING_TITLE', 'critical', 1), // 15 分
        ...checks('EMPTY_CONTENT', 'critical', 1), // 20 分
      ],
      weights,
    })

    expect(result.map((i) => i.code)).toEqual(['EMPTY_CONTENT', 'MISSING_TITLE'])
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
