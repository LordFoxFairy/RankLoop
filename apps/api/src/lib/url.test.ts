import { describe, expect, it } from 'vitest'
import { belongsToSite, contentUrl, normalizeOrigin, normalizePath } from './url'

describe('origin 规范化', () => {
  it('统一大小写', () => {
    expect(normalizeOrigin('https://Example.COM')).toBe('https://example.com')
  })

  it('去掉默认端口', () => {
    expect(normalizeOrigin('https://example.com:443')).toBe('https://example.com')
    expect(normalizeOrigin('http://example.com:80')).toBe('http://example.com')
  })

  it('保留非默认端口', () => {
    expect(normalizeOrigin('http://example.com:8080')).toBe('http://example.com:8080')
  })

  it('丢弃路径与查询串', () => {
    expect(normalizeOrigin('https://example.com/path?q=1')).toBe('https://example.com')
  })

  it('拒绝非 HTTP(S) 协议', () => {
    // 规格 §8.1：仅允许 http/https
    expect(() => normalizeOrigin('file:///etc/passwd')).toThrow()
    expect(() => normalizeOrigin('javascript:alert(1)')).toThrow()
    expect(() => normalizeOrigin('ftp://example.com')).toThrow()
  })

  it('http 与 https 是不同 origin', () => {
    expect(normalizeOrigin('http://example.com')).not.toBe(normalizeOrigin('https://example.com'))
  })
})

describe('路径规范化', () => {
  it('补全前导斜杠', () => {
    expect(normalizePath('article')).toBe('/article')
  })

  it('去掉尾部斜杠，避免 /a 与 /a/ 重复', () => {
    expect(normalizePath('/article/')).toBe('/article')
  })

  it('折叠重复斜杠', () => {
    expect(normalizePath('/a//b')).toBe('/a/b')
  })

  it('统一小写', () => {
    expect(normalizePath('/Article')).toBe('/article')
  })

  it('阻断路径穿越', () => {
    // path 参与最终 URL 拼接，放任 .. 可把内容挂到非预期路径
    expect(() => normalizePath('/a/../../etc')).toThrow(/相对片段/)
    expect(() => normalizePath('/../secret')).toThrow(/相对片段/)
  })

  it('阻断编码后的路径穿越', () => {
    // %2e%2e 解码后即 ..，必须先解码再检测
    expect(() => normalizePath('/a/%2e%2e/b')).toThrow(/相对片段/)
  })

  it('阻断空字节', () => {
    expect(() => normalizePath('/a\0b')).toThrow(/空字节/)
  })

  it('拒绝无效的百分号编码', () => {
    expect(() => normalizePath('/a%ZZ')).toThrow(/百分号编码/)
  })

  it('根路径规范为 /', () => {
    expect(normalizePath('/')).toBe('/')
    expect(normalizePath('')).toBe('/')
  })
})

describe('内容 URL 拼接', () => {
  it('拼出绝对 URL', () => {
    expect(contentUrl('https://example.com', '/article')).toBe('https://example.com/article')
  })

  it('拼接时同样阻断穿越', () => {
    expect(() => contentUrl('https://example.com', '/../evil')).toThrow()
  })
})

describe('站点归属判定', () => {
  it('同 origin 判定为属于本站', () => {
    expect(belongsToSite('https://example.com/a', 'https://example.com')).toBe(true)
  })

  it('不同域名判定为不属于', () => {
    // 规格 §3.7：IndexNow 只接受属于该站点的 URL，
    // 否则可借平台向搜索引擎提交他人站点的 URL
    expect(belongsToSite('https://evil.com/a', 'https://example.com')).toBe(false)
  })

  it('子域名不算同站', () => {
    expect(belongsToSite('https://sub.example.com/a', 'https://example.com')).toBe(false)
  })

  it('协议不同不算同站', () => {
    expect(belongsToSite('http://example.com/a', 'https://example.com')).toBe(false)
  })

  it('畸形 URL 返回 false 而非抛错', () => {
    expect(belongsToSite('not a url', 'https://example.com')).toBe(false)
  })
})
