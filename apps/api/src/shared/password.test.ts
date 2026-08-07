import { describe, expect, it } from 'vitest'
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  validatePasswordStrength,
  verifyPassword,
  verifySessionToken,
} from './password'

describe('密码哈希', () => {
  it('正确密码验证通过', async () => {
    const hash = await hashPassword('correct-horse-battery')
    expect(await verifyPassword(hash, 'correct-horse-battery')).toBe(true)
  })

  it('错误密码验证失败', async () => {
    const hash = await hashPassword('correct-horse-battery')
    expect(await verifyPassword(hash, 'wrong-password-here')).toBe(false)
  })

  it('相同密码产生不同哈希——每次加盐', async () => {
    const a = await hashPassword('same-password-value')
    const b = await hashPassword('same-password-value')
    expect(a).not.toBe(b)
  })

  it('使用 argon2id 而非更弱的变体', async () => {
    expect(await hashPassword('some-password-x')).toContain('$argon2id$')
  })

  it('哈希中不含明文', async () => {
    const hash = await hashPassword('my-secret-password')
    expect(hash).not.toContain('my-secret-password')
  })

  it('损坏的哈希不抛异常，按失败处理', async () => {
    // 数据损坏不应让登录接口 500
    expect(await verifyPassword('not-a-valid-hash', 'anything')).toBe(false)
    expect(await verifyPassword('', 'anything')).toBe(false)
  })
})

describe('会话令牌', () => {
  it('每次生成的令牌都不同', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateSessionToken().token))
    expect(set.size).toBe(100)
  })

  it('入库的是哈希而非明文', () => {
    const { token, hash } = generateSessionToken()
    expect(hash).not.toBe(token)
    expect(hash).not.toContain(token)
  })

  it('正确令牌校验通过', () => {
    const { token, hash } = generateSessionToken()
    expect(verifySessionToken(token, hash)).toBe(true)
  })

  it('错误令牌校验失败', () => {
    const { hash } = generateSessionToken()
    expect(verifySessionToken(generateSessionToken().token, hash)).toBe(false)
  })

  it('畸形哈希不抛异常', () => {
    // timingSafeEqual 对长度不等会抛错，必须先挡住
    const { token } = generateSessionToken()
    expect(verifySessionToken(token, 'deadbeef')).toBe(false)
    expect(verifySessionToken(token, '')).toBe(false)
  })

  it('相同令牌产生相同哈希——查库需要可重现', () => {
    expect(hashSessionToken('abc')).toBe(hashSessionToken('abc'))
  })
})

describe('密码强度', () => {
  it('接受足够长的密码', () => {
    expect(validatePasswordStrength('a-long-enough-password').ok).toBe(true)
  })

  it('拒绝过短密码', () => {
    expect(validatePasswordStrength('short').ok).toBe(false)
  })

  it('不强制字符类别——长度才是有效因素', () => {
    // NIST 800-63B：强制大小写数字符号反而导致可预测的模式
    expect(validatePasswordStrength('aaaaaaaaaaaaaaa').ok).toBe(true)
  })

  it('拒绝超长密码，避免哈希计算被滥用', () => {
    expect(validatePasswordStrength('a'.repeat(500)).ok).toBe(false)
  })
})
