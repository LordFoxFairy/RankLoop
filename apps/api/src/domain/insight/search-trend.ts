/**
 * 搜索表现的环比口径。
 *
 * Google 明确建议站长盯的是「流量下滑」，而不是只看当期绝对值——
 * 「28 天 100 次点击」本身说明不了任何问题，和上一个 28 天比才有意义。
 *
 * 三个指标三种口径，混用会得出误导性的结论：
 *   - 点击/曝光：相对百分比（翻倍就是 +100%）
 *   - 点击率：百分点差（2%→3% 是 +1pp，说 +50% 会让人以为流量涨了一半）
 *   - 平均排名：越小越好，方向与其余指标相反
 *
 * 这些换算过去散在路由处理函数里，谁都能顺手加一个方向写反的判断。
 * 抽到这里是为了能被测试钉死：排名恶化绝不能显示成「变好」。
 */

/** 一个统计周期的搜索表现汇总 */
export interface SearchPeriod {
  clicks: number
  impressions: number
  /** Google 的平均排名，1 是最好；无数据时为 0 */
  position: number
}

export interface SearchComparison {
  clicks: number
  impressions: number
  /** 汇总 CTR（总点击/总曝光），不是每日 CTR 的平均 */
  ctr: number
  position: number
  clicks_change: number
  clicks_change_pct: number | null
  impressions_change: number
  impressions_change_pct: number | null
  /** 百分点差，不是相对百分比 */
  ctr_change_pp: number | null
  /** 负数=名次前进。前端据此配色，正数应显示为恶化 */
  position_change: number | null
}

/**
 * 相对变化百分比。
 *
 * 上期为 0 时返回 null：从 0 涨到 N 的增幅在数学上是无穷大，
 * 显示「+∞%」没用，硬写成「+100%」是编数据。让调用方不显示变化。
 */
export function changePct(now: number, prev: number): number | null {
  if (prev <= 0) return null
  return Number((((now - prev) / prev) * 100).toFixed(1))
}

/** 汇总 CTR。曝光为 0 时 CTR 无定义，返回 0 而非除零得 NaN。 */
export function ratio(clicks: number, impressions: number): number {
  return impressions > 0 ? clicks / impressions : 0
}

export function compareSearchPeriods(
  current: SearchPeriod,
  previous: SearchPeriod,
): SearchComparison {
  const ctr = ratio(current.clicks, current.impressions)
  const prevCtr = ratio(previous.clicks, previous.impressions)

  return {
    clicks: current.clicks,
    impressions: current.impressions,
    ctr: Number(ctr.toFixed(4)),
    position: Number(current.position.toFixed(1)),
    clicks_change: current.clicks - previous.clicks,
    clicks_change_pct: changePct(current.clicks, previous.clicks),
    impressions_change: current.impressions - previous.impressions,
    impressions_change_pct: changePct(current.impressions, previous.impressions),
    // 上期没有曝光就没有可比的 CTR——0% 与「无数据」是两回事
    ctr_change_pp:
      previous.impressions > 0 ? Number(((ctr - prevCtr) * 100).toFixed(2)) : null,
    // 上期排名为 0 表示当时没有任何展现，不构成可比基准
    position_change:
      previous.position > 0
        ? Number((current.position - previous.position).toFixed(1))
        : null,
  }
}
