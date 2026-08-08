/**
 * Chrome UX Report（CrUX）客户端：读取 Core Web Vitals。
 *
 * 为什么是读而不是测：LCP / INP / CLS 衡量的是真实浏览器为真实用户
 * 渲染页面的过程，平台只收到第三方推来的一份 HTML 文本，测不出这些值。
 * 自建渲染爬虫能测，但要跑 Chrome 集群——单实例峰值 500M~1G 且 CPU 密集，
 * 部署机上还跑着别人的服务，塞不下。CrUX 是免费且数据为真的那条路：
 * 它汇总真实 Chrome 用户上报，也正是 Google 排名时参考的同一份数据。
 *
 * 认证用 API Key（不是 OAuth），与 GSC 的服务账号无关，两者独立配置。
 *
 * 最关键的一点：样本量不足时 CrUX 返回 404 NOT_FOUND，这是**正常状态**
 * 而不是故障。低流量页面本来就查不到——新站点会持续数月如此。
 * 因此这里把 404 映射成 { hasData: false } 而非抛错，否则日志会被刷屏，
 * 面板也只能显示一个吓人的错误态来描述一件完全正常的事。
 */

const ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord'

/** Google 判定「好」的阈值，取自 web.dev 官方标准 */
export const CWV_THRESHOLDS = {
  lcp: { good: 2500, poor: 4000, unit: 'ms' },
  inp: { good: 200, poor: 500, unit: 'ms' },
  cls: { good: 0.1, poor: 0.25, unit: '' },
} as const

export type FormFactor = 'PHONE' | 'DESKTOP' | 'ALL'

export interface CruxResult {
  /** Google 是否有足够样本；false 时所有指标为 null */
  hasData: boolean
  lcpP75: number | null
  inpP75: number | null
  clsP75: number | null
  /** 处于「好」区间的流量占比 0–1 */
  lcpGood: number | null
  inpGood: number | null
  clsGood: number | null
}

const EMPTY: CruxResult = {
  hasData: false,
  lcpP75: null,
  inpP75: null,
  clsP75: null,
  lcpGood: null,
  inpGood: null,
  clsGood: null,
}

interface CruxMetric {
  percentiles?: { p75?: number | string }
  histogram?: Array<{ start?: number | string; end?: number | string; density?: number }>
}

/** p75 可能以字符串返回（CLS 这类小数），统一转数字 */
function p75(metric: CruxMetric | undefined): number | null {
  const raw = metric?.percentiles?.p75
  if (raw === undefined || raw === null) return null
  const n = typeof raw === 'string' ? Number(raw) : raw
  return Number.isFinite(n) ? n : null
}

/**
 * 「好」区间的占比。
 *
 * CrUX 的 histogram 固定三档，第一档即「好」。取 density 而不是自己
 * 按阈值换算——Google 怎么分档由它说了算，我们跟着它走才不会对不上。
 */
function goodDensity(metric: CruxMetric | undefined): number | null {
  const first = metric?.histogram?.[0]
  if (!first || typeof first.density !== 'number') return null
  return Number(first.density.toFixed(4))
}

export function parseCruxRecord(body: unknown): CruxResult {
  const metrics = (body as { record?: { metrics?: Record<string, CruxMetric> } })?.record?.metrics
  if (!metrics) return EMPTY

  const lcp = metrics.largest_contentful_paint
  const inp = metrics.interaction_to_next_paint
  const cls = metrics.cumulative_layout_shift

  const result: CruxResult = {
    hasData: true,
    lcpP75: p75(lcp),
    inpP75: p75(inp),
    clsP75: p75(cls),
    lcpGood: goodDensity(lcp),
    inpGood: goodDensity(inp),
    clsGood: goodDensity(cls),
  }

  // 三项全空说明返回体里没有可用指标，等同于没数据——
  // 标成 hasData:true 会让面板显示一排空白却宣称「已采集」
  if (result.lcpP75 === null && result.inpP75 === null && result.clsP75 === null) {
    return EMPTY
  }
  return result
}

export class CruxQuotaExceeded extends Error {
  constructor() {
    super('CrUX API 配额已用尽')
    this.name = 'CruxQuotaExceeded'
  }
}

/**
 * 查询某个 origin 或 URL 的 CWV。
 *
 * @param target 传 origin（如 https://example.com）查整站汇总，
 *               传具体 URL 查单页。单页要求的样本量更高，更容易 404。
 */
export async function fetchCrux(params: {
  apiKey: string
  target: string
  scope?: 'origin' | 'url'
  formFactor?: FormFactor
  fetchImpl?: typeof fetch
}): Promise<CruxResult> {
  const doFetch = params.fetchImpl ?? fetch
  const scope = params.scope ?? 'origin'
  const body: Record<string, unknown> =
    scope === 'origin' ? { origin: params.target } : { url: params.target }

  // ALL 表示不限设备，此时不能传 formFactor 字段（传了会被当成过滤条件）
  if (params.formFactor && params.formFactor !== 'ALL') {
    body.formFactor = params.formFactor
  }

  const res = await doFetch(`${ENDPOINT}?key=${encodeURIComponent(params.apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  // 404 = 样本不足，是常态不是错误。低流量页面本就查不到。
  if (res.status === 404) return EMPTY

  // 429 要让调用方知道，以便停止本轮而不是继续打满配额
  if (res.status === 429) throw new CruxQuotaExceeded()

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`CrUX 请求失败 ${res.status}：${text.slice(0, 200)}`)
  }

  return parseCruxRecord(await res.json())
}

/** 按 Google 标准给单项指标定级，供前端配色 */
export function rateMetric(
  kind: keyof typeof CWV_THRESHOLDS,
  value: number | null,
): 'good' | 'needs-improvement' | 'poor' | 'unknown' {
  if (value === null) return 'unknown'
  const t = CWV_THRESHOLDS[kind]
  if (value <= t.good) return 'good'
  if (value <= t.poor) return 'needs-improvement'
  return 'poor'
}
