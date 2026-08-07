/**
 * 发布事件标注。
 *
 * 平台独占发布时间戳——外部 SEO 工具只能看到流量曲线，
 * 看不出「哪天发布了什么」，因此画不出因果。
 * 把发布事件叠在搜索表现趋势上，用户才能看出
 * 「这次发布之后曝光涨了」还是「改完标题点击才起来」。
 *
 * 这是本产品相对通用 SEO 工具的结构性优势，不是锦上添花。
 */

export interface PublishEvent {
  /** 发布日期，YYYY-MM-DD */
  date: string
  count: number
  /** 当天发布的内容标题，用于标注悬浮提示 */
  titles: string[]
}

export interface TrendPoint {
  date: string
  clicks: number
  impressions: number
  position: number
}

export interface AnnotatedTrendPoint extends TrendPoint {
  /** 当天发布的内容数，0 表示无发布 */
  published: number
  publishedTitles: string[]
}

/** 把发布事件合并进趋势序列 */
export function annotateTrend(
  trend: readonly TrendPoint[],
  events: readonly PublishEvent[],
): AnnotatedTrendPoint[] {
  const byDate = new Map(events.map((e) => [e.date, e]))
  return trend.map((p) => {
    const e = byDate.get(p.date)
    return {
      ...p,
      published: e?.count ?? 0,
      // 标题过多时截断，避免提示框撑爆
      publishedTitles: (e?.titles ?? []).slice(0, 5),
    }
  })
}

export interface PeriodDelta {
  clicks: { current: number; previous: number; change: number }
  impressions: { current: number; previous: number; change: number }
  /** 名次下降为正向改善，因此单独处理方向 */
  position: { current: number; previous: number; change: number }
  /** 对比区间是否有足够数据，不足时前端不应显示涨跌 */
  comparable: boolean
}

/**
 * 环比：本期 vs 上一个等长区间。
 *
 * 不用「平均排名」当主指标——它会被大量长尾词稀释，
 * 新页面刚收录时排名靠后反而会拉低平均值，看起来像退步。
 * 因此点击与曝光是主指标，排名只作参考。
 */
export function periodDelta(trend: readonly TrendPoint[]): PeriodDelta {
  const half = Math.floor(trend.length / 2)
  const previous = trend.slice(0, half)
  const current = trend.slice(half)

  const sum = (rows: readonly TrendPoint[], key: 'clicks' | 'impressions') =>
    rows.reduce((s, r) => s + r[key], 0)

  // 排名要按有曝光的天数平均，无曝光的天排名为 0 会把均值拉向 0
  const avgPosition = (rows: readonly TrendPoint[]) => {
    const withData = rows.filter((r) => r.impressions > 0)
    if (withData.length === 0) return 0
    return withData.reduce((s, r) => s + r.position, 0) / withData.length
  }

  const pct = (cur: number, prev: number) =>
    prev === 0 ? (cur > 0 ? 100 : 0) : Number((((cur - prev) / prev) * 100).toFixed(1))

  const curPos = avgPosition(current)
  const prevPos = avgPosition(previous)

  return {
    clicks: {
      current: sum(current, 'clicks'),
      previous: sum(previous, 'clicks'),
      change: pct(sum(current, 'clicks'), sum(previous, 'clicks')),
    },
    impressions: {
      current: sum(current, 'impressions'),
      previous: sum(previous, 'impressions'),
      change: pct(sum(current, 'impressions'), sum(previous, 'impressions')),
    },
    position: {
      current: Number(curPos.toFixed(1)),
      previous: Number(prevPos.toFixed(1)),
      // 名次变小是改善，取负号让「正数 = 变好」与点击口径一致
      change: prevPos === 0 || curPos === 0 ? 0 : Number((prevPos - curPos).toFixed(1)),
    },
    // 两个半区都要有数据才谈得上对比
    comparable: previous.length > 0 && current.length > 0 && sum(previous, 'impressions') > 0,
  }
}
