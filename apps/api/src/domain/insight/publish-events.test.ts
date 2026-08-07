import { describe, expect, it } from 'vitest'
import { type TrendPoint, annotateTrend, periodDelta } from './publish-events'

function pt(date: string, clicks: number, impressions: number, position = 10): TrendPoint {
  return { date, clicks, impressions, position }
}

describe('发布事件标注', () => {
  it('把发布事件对齐到趋势的对应日期', () => {
    const out = annotateTrend(
      [pt('2026-08-01', 0, 0), pt('2026-08-02', 5, 100)],
      [{ date: '2026-08-02', count: 2, titles: ['文章一', '文章二'] }],
    )

    expect(out[0].published).toBe(0)
    expect(out[1].published).toBe(2)
    expect(out[1].publishedTitles).toEqual(['文章一', '文章二'])
  })

  it('无发布的日期标为 0，而非缺字段', () => {
    // 前端要能直接读 published，不必判断 undefined
    const out = annotateTrend([pt('2026-08-01', 0, 0)], [])
    expect(out[0].published).toBe(0)
    expect(out[0].publishedTitles).toEqual([])
  })

  it('落在趋势区间外的发布事件被忽略——不能凭空造出趋势点', () => {
    const out = annotateTrend(
      [pt('2026-08-02', 5, 100)],
      [{ date: '2026-07-01', count: 9, titles: ['旧文章'] }],
    )

    expect(out).toHaveLength(1)
    expect(out[0].published).toBe(0)
  })

  it('单日发布过多时截断标题，避免提示框撑爆', () => {
    const titles = Array.from({ length: 12 }, (_, i) => `文章${i}`)
    const out = annotateTrend(
      [pt('2026-08-02', 5, 100)],
      [{ date: '2026-08-02', count: 12, titles }],
    )

    // 计数保留真实值，只截断展示用的标题
    expect(out[0].published).toBe(12)
    expect(out[0].publishedTitles).toHaveLength(5)
  })

  it('保留原始趋势数值不被改写', () => {
    const out = annotateTrend([pt('2026-08-02', 5, 100, 7.5)], [])
    expect(out[0]).toMatchObject({ clicks: 5, impressions: 100, position: 7.5 })
  })
})

describe('环比', () => {
  it('对半切分并计算点击涨幅', () => {
    const d = periodDelta([
      pt('2026-08-01', 10, 100),
      pt('2026-08-02', 10, 100),
      pt('2026-08-03', 15, 150),
      pt('2026-08-04', 15, 150),
    ])

    expect(d.clicks.previous).toBe(20)
    expect(d.clicks.current).toBe(30)
    expect(d.clicks.change).toBe(50)
  })

  it('名次前进记为正向改善——与点击口径一致，正数即变好', () => {
    // 排名从 20 名升到 5 名是巨大改善，但数值在变小
    const d = periodDelta([
      pt('2026-08-01', 1, 100, 20),
      pt('2026-08-02', 1, 100, 20),
      pt('2026-08-03', 1, 100, 5),
      pt('2026-08-04', 1, 100, 5),
    ])

    expect(d.position.change).toBeGreaterThan(0)
    expect(d.position.change).toBe(15)
  })

  it('无曝光的天不参与排名平均——否则会把均值拉向 0，假装排名很好', () => {
    const d = periodDelta([
      pt('2026-08-01', 0, 0, 0), // 无数据的天
      pt('2026-08-02', 1, 100, 10),
      pt('2026-08-03', 0, 0, 0),
      pt('2026-08-04', 1, 100, 8),
    ])

    expect(d.position.previous).toBe(10)
    expect(d.position.current).toBe(8)
  })

  it('上期为零时不产生除零错误', () => {
    const d = periodDelta([pt('2026-08-01', 0, 0), pt('2026-08-02', 5, 100)])
    expect(Number.isFinite(d.clicks.change)).toBe(true)
    expect(d.clicks.change).toBe(100)
  })

  it('上期无曝光时标记为不可对比——不能拿零基数吹涨幅', () => {
    // 新站第一周没有任何曝光，说「增长 100%」是误导
    const d = periodDelta([pt('2026-08-01', 0, 0), pt('2026-08-02', 5, 100)])
    expect(d.comparable).toBe(false)
  })

  it('两期都有数据时可对比', () => {
    const d = periodDelta([pt('2026-08-01', 1, 50), pt('2026-08-02', 5, 100)])
    expect(d.comparable).toBe(true)
  })

  it('空趋势不崩且不可对比', () => {
    const d = periodDelta([])
    expect(d.comparable).toBe(false)
    expect(d.clicks.current).toBe(0)
  })

  it('下降如实反映为负数，不粉饰', () => {
    const d = periodDelta([
      pt('2026-08-01', 20, 200),
      pt('2026-08-02', 20, 200),
      pt('2026-08-03', 5, 50),
      pt('2026-08-04', 5, 50),
    ])

    expect(d.clicks.change).toBe(-75)
  })
})
