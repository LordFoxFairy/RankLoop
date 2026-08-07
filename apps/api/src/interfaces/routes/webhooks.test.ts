import { describe, expect, it } from 'vitest'
import { assertSafeWebhookUrl } from './webhooks'

/**
 * 回调地址校验。
 *
 * 平台会主动请求这个地址，因此它是一个 SSRF 攻击面：
 * 拿到密钥的人可以让平台代为请求内网服务。必须在登记时就挡住。
 */
describe('回调地址校验', () => {
  it('接受正常的 https 地址', () => {
    expect(() => assertSafeWebhookUrl('https://hooks.acme.com/rankloop')).not.toThrow()
  })

  it('拒绝 http——明文会让签名保护的内容在链路上可见', () => {
    expect(() => assertSafeWebhookUrl('http://hooks.acme.com/x')).toThrow(/https/)
  })

  it('拒绝 localhost', () => {
    expect(() => assertSafeWebhookUrl('https://localhost/x')).toThrow(/内网|本机/)
  })

  it('拒绝回环地址', () => {
    expect(() => assertSafeWebhookUrl('https://127.0.0.1/x')).toThrow(/内网|本机/)
  })

  it.each([
    'https://10.0.0.5/x',
    'https://192.168.1.1/x',
    'https://172.16.0.1/x',
    'https://172.31.255.254/x',
  ])('拒绝私有网段 %s', (url) => {
    expect(() => assertSafeWebhookUrl(url)).toThrow(/内网|本机/)
  })

  it('拒绝云元数据地址——169.254.169.254 能读到实例凭据', () => {
    expect(() => assertSafeWebhookUrl('https://169.254.169.254/latest/meta-data/')).toThrow(
      /内网|本机/,
    )
  })

  it('拒绝 .internal / .local 内部域名', () => {
    expect(() => assertSafeWebhookUrl('https://db.internal/x')).toThrow(/内网|本机/)
    expect(() => assertSafeWebhookUrl('https://printer.local/x')).toThrow(/内网|本机/)
  })

  it('不误伤形似私有段的公网地址', () => {
    // 172.32 不在 172.16-31 私有段内
    expect(() => assertSafeWebhookUrl('https://172.32.0.1/x')).not.toThrow()
    // 域名里含 10. 不代表是内网
    expect(() => assertSafeWebhookUrl('https://10.acme.com/x')).not.toThrow()
  })

  it('拒绝非法 URL', () => {
    expect(() => assertSafeWebhookUrl('not a url')).toThrow(/合法/)
  })
})
