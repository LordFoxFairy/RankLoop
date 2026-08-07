import { describe, expect, it } from 'vitest'
import { InvalidHost, isValidSlug, parseHost, siteOrigin } from './host-routing'

const PLATFORM = 'rankloop.miaokit.cloud'

describe('Host 解析 — 子域名形态', () => {
  it('解析出租户 slug', () => {
    expect(parseHost('acme.rankloop.miaokit.cloud', PLATFORM)).toEqual({ slug: 'acme' })
  })

  it('忽略端口', () => {
    expect(parseHost('acme.rankloop.miaokit.cloud:8080', PLATFORM)).toEqual({ slug: 'acme' })
  })

  it('大小写不敏感', () => {
    expect(parseHost('ACME.RankLoop.MiaoKit.Cloud', PLATFORM)).toEqual({ slug: 'acme' })
  })

  it('去掉根域名末尾的点（FQDN 形式）', () => {
    expect(parseHost('acme.rankloop.miaokit.cloud.', PLATFORM)).toEqual({ slug: 'acme' })
  })

  it('平台域名本身不解析为租户', () => {
    expect(parseHost(PLATFORM, PLATFORM)).toEqual({})
  })

  it('拒绝多层子域名——防止 evil.tenant.平台域名 混淆归属', () => {
    // 若接受多层，攻击者可构造看似属于某租户的地址
    expect(parseHost('evil.acme.rankloop.miaokit.cloud', PLATFORM)).toEqual({})
  })

  it('保留子域名不作为租户', () => {
    for (const s of ['www', 'api', 'admin', 'console']) {
      expect(parseHost(`${s}.${PLATFORM}`, PLATFORM)).toEqual({})
    }
  })

  it('非法 slug 不解析为租户', () => {
    expect(parseHost(`-bad.${PLATFORM}`, PLATFORM)).toEqual({})
    expect(parseHost(`bad-.${PLATFORM}`, PLATFORM)).toEqual({})
    expect(parseHost(`UPPER_case.${PLATFORM}`, PLATFORM)).toEqual({})
  })
})

describe('Host 解析 — 自定义域名形态', () => {
  it('非平台域名按自定义域名查找', () => {
    expect(parseHost('blog.acme.com', PLATFORM)).toEqual({ domain: 'blog.acme.com' })
  })

  it('裸域名同样支持', () => {
    expect(parseHost('acme.com', PLATFORM)).toEqual({ domain: 'acme.com' })
  })

  it('相似但不同的域名不会误判为平台子域名', () => {
    // rankloop.miaokit.cloud.evil.com 结尾不是 .平台域名，应走自定义域名查找
    expect(parseHost('rankloop.miaokit.cloud.evil.com', PLATFORM)).toEqual({
      domain: 'rankloop.miaokit.cloud.evil.com',
    })
  })

  it('后缀相似的域名不误判', () => {
    // xrankloop.miaokit.cloud 不是 rankloop.miaokit.cloud 的子域名
    expect(parseHost('notrankloop.miaokit.cloud', PLATFORM)).toEqual({
      domain: 'notrankloop.miaokit.cloud',
    })
  })
})

describe('Host 解析 — 异常输入', () => {
  it('空 Host 抛错', () => {
    expect(() => parseHost('', PLATFORM)).toThrow(InvalidHost)
  })

  it('只有端口的 Host 抛错', () => {
    expect(() => parseHost(':8080', PLATFORM)).toThrow(InvalidHost)
  })
})

describe('slug 合法性', () => {
  it('接受常规 slug', () => {
    expect(isValidSlug('acme')).toBe(true)
    expect(isValidSlug('acme-blog')).toBe(true)
    expect(isValidSlug('a1')).toBe(true)
  })

  it('拒绝保留名', () => {
    expect(isValidSlug('www')).toBe(false)
    expect(isValidSlug('admin')).toBe(false)
  })

  it('拒绝首尾连字符与非法字符', () => {
    expect(isValidSlug('-a')).toBe(false)
    expect(isValidSlug('a-')).toBe(false)
    expect(isValidSlug('a_b')).toBe(false)
    expect(isValidSlug('A')).toBe(false)
  })

  it('拒绝空字符串', () => {
    expect(isValidSlug('')).toBe(false)
  })
})

describe('站点根地址', () => {
  it('默认使用子域名', () => {
    expect(siteOrigin({ slug: 'acme', platformDomain: PLATFORM })).toBe(
      'https://acme.rankloop.miaokit.cloud',
    )
  })

  it('自定义域名已验证时优先使用', () => {
    expect(
      siteOrigin({
        slug: 'acme',
        domain: 'blog.acme.com',
        domainVerifiedAt: new Date(),
        platformDomain: PLATFORM,
      }),
    ).toBe('https://blog.acme.com')
  })

  it('自定义域名未验证时回退到子域名', () => {
    // 未验证就用会导致 canonical 指向不可访问地址，损害 SEO
    expect(
      siteOrigin({
        slug: 'acme',
        domain: 'blog.acme.com',
        domainVerifiedAt: null,
        platformDomain: PLATFORM,
      }),
    ).toBe('https://acme.rankloop.miaokit.cloud')
  })
})
