import { describe, expect, it } from 'vitest'
import { CruxQuotaExceeded, fetchCrux, parseCruxRecord, rateMetric } from './crux'

const record = {
  record: {
    metrics: {
      largest_contentful_paint: {
        percentiles: { p75: 1800 },
        histogram: [{ density: 0.82 }, { density: 0.12 }, { density: 0.06 }],
      },
      interaction_to_next_paint: {
        percentiles: { p75: 150 },
        histogram: [{ density: 0.9 }, { density: 0.08 }, { density: 0.02 }],
      },
      cumulative_layout_shift: {
        // CLS 的 p75 以字符串返回，这是 CrUX 的实际行为
        percentiles: { p75: '0.05' },
        histogram: [{ density: 0.95 }, { density: 0.03 }, { density: 0.02 }],
      },
    },
  },
}

const res = (status: number, body: unknown = {}) =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response

describe('fetchCrux', () => {
  it('404 是「样本不足」而不是错误', async () => {
    // 低流量页面本就查不到，新站会持续数月如此。
    // 若抛错，日志会被刷屏，面板也只能显示错误态来描述一件正常的事。
    const r = await fetchCrux({
      apiKey: 'k',
      target: 'https://new-site.example',
      fetchImpl: async () => res(404, { error: { code: 404, status: 'NOT_FOUND' } }),
    })
    expect(r.hasData).toBe(false)
    expect(r.lcpP75).toBeNull()
  })

  it('429 要抛出，让调用方停止本轮', async () => {
    await expect(
      fetchCrux({ apiKey: 'k', target: 'https://x.example', fetchImpl: async () => res(429) }),
    ).rejects.toBeInstanceOf(CruxQuotaExceeded)
  })

  it('其他非 2xx 抛错，不能静默当成没数据', async () => {
    // 把 500 当成「没数据」会掩盖真实故障
    await expect(
      fetchCrux({ apiKey: 'k', target: 'https://x.example', fetchImpl: async () => res(500) }),
    ).rejects.toThrow(/500/)
  })

  it('origin 与 url 两种粒度发不同的请求体', async () => {
    let sent: Record<string, unknown> = {}
    const spy = async (_u: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body))
      return res(200, record)
    }
    await fetchCrux({ apiKey: 'k', target: 'https://x.example', fetchImpl: spy as typeof fetch })
    expect(sent).toHaveProperty('origin')

    await fetchCrux({
      apiKey: 'k',
      target: 'https://x.example/p',
      scope: 'url',
      fetchImpl: spy as typeof fetch,
    })
    expect(sent).toHaveProperty('url')
  })

  it('formFactor 为 ALL 时不发该字段', async () => {
    // 传了会被当成过滤条件，反而拿不到「不限设备」的汇总
    let sent: Record<string, unknown> = {}
    await fetchCrux({
      apiKey: 'k',
      target: 'https://x.example',
      formFactor: 'ALL',
      fetchImpl: (async (_u: string, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body))
        return res(200, record)
      }) as typeof fetch,
    })
    expect(sent).not.toHaveProperty('formFactor')
  })
})

describe('parseCruxRecord', () => {
  it('解析三项指标与「好」占比', () => {
    const r = parseCruxRecord(record)
    expect(r.hasData).toBe(true)
    expect(r.lcpP75).toBe(1800)
    expect(r.inpP75).toBe(150)
    expect(r.clsP75).toBe(0.05) // 字符串被转成数字
    expect(r.lcpGood).toBe(0.82)
  })

  it('空响应体视为没数据', () => {
    expect(parseCruxRecord({}).hasData).toBe(false)
  })

  it('有 record 但三项指标全空时视为没数据', () => {
    // 标成 hasData:true 会让面板显示一排空白却宣称「已采集」
    const r = parseCruxRecord({ record: { metrics: { some_other_metric: {} } } })
    expect(r.hasData).toBe(false)
  })
})

describe('rateMetric', () => {
  it('按 Google 官方阈值定级', () => {
    expect(rateMetric('lcp', 2000)).toBe('good') // ≤2500
    expect(rateMetric('lcp', 3000)).toBe('needs-improvement')
    expect(rateMetric('lcp', 5000)).toBe('poor') // >4000
    expect(rateMetric('cls', 0.05)).toBe('good')
    expect(rateMetric('cls', 0.3)).toBe('poor')
  })

  it('没有数据时不猜，返回 unknown', () => {
    // 返回 'good' 会把「不知道」粉饰成「很好」
    expect(rateMetric('inp', null)).toBe('unknown')
  })
})
