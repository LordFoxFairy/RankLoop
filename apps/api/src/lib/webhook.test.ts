import { describe, expect, it } from 'vitest'
import {
  MAX_WEBHOOK_ATTEMPTS,
  buildPayload,
  nextRetryDelayMs,
  signPayload,
  verifySignature,
} from './webhook'

const SECRET = 'whsec_test_secret'
const NOW = 1_700_000_000

describe('Webhook 签名', () => {
  it('正确签名校验通过', () => {
    const body = JSON.stringify({ event: 'content.published' })
    const header = signPayload(body, SECRET, NOW)
    expect(verifySignature({ body, secret: SECRET, header, now: NOW })).toBe(true)
  })

  it('body 被篡改则校验失败', () => {
    const body = JSON.stringify({ amount: 1 })
    const header = signPayload(body, SECRET, NOW)
    const tampered = JSON.stringify({ amount: 999 })
    expect(verifySignature({ body: tampered, secret: SECRET, header, now: NOW })).toBe(false)
  })

  it('密钥不同则校验失败', () => {
    const body = '{}'
    const header = signPayload(body, SECRET, NOW)
    expect(verifySignature({ body, secret: 'wrong_secret', header, now: NOW })).toBe(false)
  })

  it('超出时间容忍窗口视为重放，拒绝', () => {
    // 攻击者截获旧请求重新发送，签名本身有效但时间戳过期
    const body = '{}'
    const header = signPayload(body, SECRET, NOW)
    expect(verifySignature({ body, secret: SECRET, header, now: NOW + 600 })).toBe(false)
  })

  it('窗口内的时钟偏差可接受', () => {
    const body = '{}'
    const header = signPayload(body, SECRET, NOW)
    expect(verifySignature({ body, secret: SECRET, header, now: NOW + 60 })).toBe(true)
  })

  it('篡改时间戳无法绕过——签名覆盖了时间戳', () => {
    const body = '{}'
    const header = signPayload(body, SECRET, NOW)
    const forged = header.replace(`t=${NOW}`, `t=${NOW + 600}`)
    expect(verifySignature({ body, secret: SECRET, header: forged, now: NOW + 600 })).toBe(false)
  })

  it('畸形签名头不抛异常，返回 false', () => {
    const cases = ['', 'garbage', 't=abc,v1=xyz', 't=123', 'v1=abc', 't=,v1=']
    for (const header of cases) {
      expect(verifySignature({ body: '{}', secret: SECRET, header, now: NOW })).toBe(false)
    }
  })
})

describe('Webhook payload', () => {
  it('每个事件有唯一 ID 供接收方去重', () => {
    const ids = new Set(
      Array.from(
        { length: 50 },
        () =>
          buildPayload({
            event: 'content.published',
            workspaceId: 'ws_1',
            data: {},
            links: {},
          }).event_id,
      ),
    )
    expect(ids.size).toBe(50)
  })

  it('采用轻 payload：只带 ID 与链接，不含正文', () => {
    // 若把正文塞进 payload，大站点会撑爆请求体，且重试时数据已过期
    const payload = buildPayload({
      event: 'content.checked',
      workspaceId: 'ws_1',
      siteId: 'site_1',
      data: { content_id: 'c_1', score: 78 },
      links: { content: '/api/v1/contents/c_1' },
    })
    const serialized = JSON.stringify(payload)
    expect(serialized.length).toBeLessThan(500)
    expect(payload.links.content).toBeTruthy()
  })
})

describe('重试退避', () => {
  it('延迟随重试次数递增', () => {
    const fixed = () => 1
    expect(nextRetryDelayMs(3, fixed)).toBeGreaterThan(nextRetryDelayMs(1, fixed))
  })

  it('有抖动，避免重试风暴同时打到接收方', () => {
    const delays = new Set(Array.from({ length: 20 }, () => nextRetryDelayMs(5)))
    expect(delays.size).toBeGreaterThan(1)
  })

  it('延迟有上限，不会无限增长', () => {
    expect(nextRetryDelayMs(100, () => 1)).toBeLessThanOrEqual(6 * 60 * 60 * 1000)
  })

  it('重试次数有上限', () => {
    expect(MAX_WEBHOOK_ATTEMPTS).toBeLessThanOrEqual(10)
  })
})
