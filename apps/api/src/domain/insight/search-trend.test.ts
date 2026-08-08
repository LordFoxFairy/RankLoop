import { describe, expect, it } from 'vitest'
import { changePct, compareSearchPeriods, ratio } from './search-trend'

const period = (clicks: number, impressions: number, position: number) => ({
  clicks,
  impressions,
  position,
})

describe('compareSearchPeriods', () => {
  it('排名变大是恶化，必须给出正的 position_change', () => {
    // 面板会用「负数=绿色」配色。若这里符号写反，
    // 「从第 12 名掉到第 30 名」会显示成绿色的好消息。
    const r = compareSearchPeriods(period(10, 100, 30), period(10, 100, 12))
    expect(r.position_change).toBe(18)
    expect(r.position_change! > 0).toBe(true)
  })

  it('排名变小是进步，给出负的 position_change', () => {
    const r = compareSearchPeriods(period(10, 100, 5), period(10, 100, 20))
    expect(r.position_change).toBe(-15)
  })

  it('CTR 用百分点差而不是相对百分比', () => {
    // 2% → 3%：相对涨了 50%，但实际只多了 1 个百分点。
    // 报「+50%」会让人以为流量涨了一半，是危险的误导。
    const r = compareSearchPeriods(period(3, 100, 10), period(2, 100, 10))
    expect(r.ctr_change_pp).toBe(1)
    expect(r.ctr).toBe(0.03)
  })

  it('上期为 0 时不编造增幅', () => {
    // 从 0 涨到 50 的相对增幅是无穷大。返回 null 让前端不显示，
    // 而不是硬写成 +100%——那是编出来的数字。
    const r = compareSearchPeriods(period(50, 500, 8), period(0, 0, 0))
    expect(r.clicks_change_pct).toBeNull()
    expect(r.impressions_change_pct).toBeNull()
    expect(r.ctr_change_pp).toBeNull()
    expect(r.position_change).toBeNull()
    // 绝对差值仍然给得出，前端可以显示「+50」
    expect(r.clicks_change).toBe(50)
  })

  it('曝光下滑要能被发现，即使点击没变', () => {
    // Google 建议盯流量下滑。曝光腰斩而点击持平，
    // 通常是排名下滑的前兆——只看点击会晚一步才察觉。
    const r = compareSearchPeriods(period(10, 500, 15), period(10, 1000, 9))
    expect(r.impressions_change).toBe(-500)
    expect(r.impressions_change_pct).toBe(-50)
    expect(r.position_change).toBe(6) // 同时排名也退了
  })

  it('曝光为 0 时 CTR 不除零', () => {
    const r = compareSearchPeriods(period(0, 0, 0), period(0, 0, 0))
    expect(r.ctr).toBe(0)
    expect(Number.isNaN(r.ctr)).toBe(false)
  })
})

describe('changePct', () => {
  it('上期非正数一律返回 null', () => {
    expect(changePct(10, 0)).toBeNull()
    expect(changePct(10, -1)).toBeNull()
  })

  it('翻倍是 +100%', () => {
    expect(changePct(200, 100)).toBe(100)
  })
})

describe('ratio', () => {
  it('分母为 0 返回 0 而不是 NaN', () => {
    expect(ratio(5, 0)).toBe(0)
  })
})
