import { describe, expect, it } from 'vitest'
import { generateApiKey, hasScope, hashApiKey, verifyApiKey } from './api-key'

describe('API Key 生成', () => {
  it('每次生成的 Key 都不同', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateApiKey().plaintext))
    expect(keys.size).toBe(100)
  })

  it('带可识别前缀', () => {
    expect(generateApiKey().plaintext.startsWith('rkl_live_')).toBe(true)
  })

  it('前缀片段不足以还原完整 Key', () => {
    const { plaintext, prefix } = generateApiKey()
    expect(prefix.length).toBeLessThan(plaintext.length)
    expect(plaintext.startsWith(prefix)).toBe(true)
  })

  it('哈希与明文不同——确保入库的不是明文', () => {
    const { plaintext, hash } = generateApiKey()
    expect(hash).not.toBe(plaintext)
    expect(hash).not.toContain(plaintext)
  })
})

describe('API Key 校验', () => {
  it('正确的 Key 校验通过', () => {
    const { plaintext, hash } = generateApiKey()
    expect(verifyApiKey(plaintext, hash)).toBe(true)
  })

  it('错误的 Key 校验失败', () => {
    const { hash } = generateApiKey()
    expect(verifyApiKey(generateApiKey().plaintext, hash)).toBe(false)
  })

  it('篡改一个字符即失败', () => {
    const { plaintext, hash } = generateApiKey()
    const tampered = `${plaintext.slice(0, -1)}${plaintext.endsWith('a') ? 'b' : 'a'}`
    expect(verifyApiKey(tampered, hash)).toBe(false)
  })

  it('长度异常的哈希不抛异常，返回 false', () => {
    // timingSafeEqual 对长度不等会抛错，必须先挡住，否则畸形输入能打挂接口
    expect(verifyApiKey(generateApiKey().plaintext, 'deadbeef')).toBe(false)
    expect(verifyApiKey(generateApiKey().plaintext, '')).toBe(false)
  })

  it('相同输入产生相同哈希', () => {
    expect(hashApiKey('rkl_live_test')).toBe(hashApiKey('rkl_live_test'))
  })
})

describe('Scope 校验', () => {
  it('拥有对应 scope 时放行', () => {
    expect(hasScope(['contents:write'], 'contents:write')).toBe(true)
  })

  it('缺少 scope 时拒绝', () => {
    expect(hasScope(['contents:read'], 'contents:write')).toBe(false)
  })

  it('读权限不隐含写权限——防止越权', () => {
    expect(hasScope(['contents:read'], 'contents:publish')).toBe(false)
  })

  it('空 scope 拒绝一切', () => {
    expect(hasScope([], 'contents:read')).toBe(false)
  })
})
