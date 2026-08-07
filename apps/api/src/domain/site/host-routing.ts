/**
 * 按 Host 头解析租户站点。
 *
 * 两种形态共用一套查找逻辑：
 *   1. 子域名：`<slug>.rankloop.miaokit.cloud` —— 默认形态，平台完全控制
 *   2. 自定义域名：`blog.客户.com` —— 按租户开关授予（Workspace.customDomainEnabled）
 *
 * 安全要点：解析结果决定访客看到哪个租户的内容，因此必须严格匹配，
 * 不能有模糊回退——否则可能把 A 租户的内容渲染给 B 租户的访客。
 */

export interface HostLookup {
  /** 精确匹配自定义域名 */
  domain?: string
  /** 子域名前缀 */
  slug?: string
}

export class InvalidHost extends Error {
  readonly code = 'INVALID_HOST'
  constructor(readonly host: string) {
    super('无法解析的 Host')
  }
}

/** 合法 slug：小写字母、数字、连字符，不以连字符开头结尾 */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** 平台自身保留的子域名，不可作为租户 slug */
export const RESERVED_SLUGS = new Set([
  'www',
  'api',
  'app',
  'admin',
  'console',
  'dashboard',
  'seo',
  'mail',
  'ftp',
  'cdn',
  'static',
  'assets',
  'docs',
  'status',
  'blog',
  'rankloop',
  'help',
  'support',
])

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug)
}

/**
 * 从 Host 头解析出查找条件。
 *
 * @param host 请求的 Host 头（可能含端口）
 * @param platformDomain 平台根域名，如 `rankloop.miaokit.cloud`
 */
export function parseHost(host: string, platformDomain: string): HostLookup {
  if (!host) throw new InvalidHost(host)

  // 去掉端口与大小写差异；Host 头由客户端提供，必须规范化后再比对
  const clean = host.toLowerCase().split(':')[0].trim().replace(/\.$/, '')
  if (!clean) throw new InvalidHost(host)

  const platform = platformDomain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')

  // 平台域名本身 → 不是租户站点（渲染平台首页）
  if (clean === platform) return {}

  // <slug>.<平台域名> → 子域名形态
  if (clean.endsWith(`.${platform}`)) {
    const slug = clean.slice(0, -(platform.length + 1))
    // 只接受单层子域名：a.b.平台域名 不视为合法租户站点，
    // 否则攻击者可构造 evil.tenant.平台域名 混淆归属
    if (!slug.includes('.') && isValidSlug(slug)) return { slug }
    return {}
  }

  // 其余一律按自定义域名查找
  return { domain: clean }
}

/** 站点的对外根地址，用于 canonical、sitemap 与内链 */
export function siteOrigin(params: {
  slug: string
  domain?: string | null
  domainVerifiedAt?: Date | null
  platformDomain: string
  protocol?: string
}): string {
  const proto = params.protocol ?? 'https'
  // 自定义域名必须验证通过才生效，否则回退到子域名——
  // 未验证就使用会导致 canonical 指向一个不可访问的地址
  if (params.domain && params.domainVerifiedAt) {
    return `${proto}://${params.domain}`
  }
  return `${proto}://${params.slug}.${params.platformDomain}`
}
