import type { PrismaClient } from '@prisma/client'
import { parseContent } from '@rankloop/seo-rules'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { parseHost, siteOrigin } from '../domain/site/host-routing'

/**
 * 多租户内容渲染。
 *
 * 打通「第三方 API 提交 → 线上可访问」这条链路：
 * 访客按 Host 命中租户站点，API 实时渲染该租户已发布的内容。
 *
 * 隔离要点：站点由 Host 唯一确定，内容查询始终带 siteId，
 * 因此 A 租户的访客不可能看到 B 租户的内容。
 */

export interface SiteSettings {
  siteName?: string
  description?: string
  lang?: string
  nav?: Array<{ label: string; href: string }>
  theme?: { accent?: string; contentWidth?: string }
  footer?: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** JSON-LD 里的 < 必须转义，否则标题含 </script> 可逃逸出脚本块 */
function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function renderPage(params: {
  settings: SiteSettings
  origin: string
  path: string
  title: string
  description: string
  body: string
  lastmod: Date
  ogImage?: string
}): string {
  const s = params.settings
  const canonical = `${params.origin}${params.path === '/' ? '/' : `${params.path}/`}`
  const siteName = s.siteName ?? '站点'
  const accent = s.theme?.accent ?? '#0b62d0'
  const width = s.theme?.contentWidth ?? '760px'
  const lang = s.lang ?? 'zh-CN'

  const nav = (s.nav ?? [])
    .map((n) => {
      const href = n.href.startsWith('/') && !n.href.endsWith('/') ? `${n.href}/` : n.href
      return `<a href="${escapeHtml(href)}">${escapeHtml(n.label)}</a>`
    })
    .join('')

  const jsonLd = safeJsonLd({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: params.title,
    description: params.description,
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    url: canonical,
    dateModified: params.lastmod.toISOString(),
    ...(params.ogImage ? { image: params.ogImage } : {}),
    publisher: { '@type': 'Organization', name: siteName, url: params.origin },
    inLanguage: lang,
  })

  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(params.title)}</title>
<meta name="description" content="${escapeHtml(params.description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${escapeHtml(siteName)}">
<meta property="og:title" content="${escapeHtml(params.title)}">
<meta property="og:description" content="${escapeHtml(params.description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
${params.ogImage ? `<meta property="og:image" content="${escapeHtml(params.ogImage)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${jsonLd}</script>
<style>
:root{color-scheme:light dark;--fg:#1a1d23;--bg:#fff;--muted:#5b6472;--line:#e4e7ec;--surface:#f7f8fa;--accent:${accent};--width:${width}}
@media(prefers-color-scheme:dark){:root{--fg:#e6e9ef;--bg:#12151a;--muted:#98a2b3;--line:#272c37;--surface:#171a21}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.75 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
header{border-bottom:1px solid var(--line);padding:14px 24px;display:flex;align-items:center;gap:22px;flex-wrap:wrap}
header .brand{color:var(--fg);text-decoration:none;font-weight:680;font-size:17px}
header nav{display:flex;gap:18px;flex-wrap:wrap}
header nav a{color:var(--muted);text-decoration:none;font-size:14px}
header nav a:hover{color:var(--accent)}
main{max-width:var(--width);margin:0 auto;padding:40px 24px 64px}
h1{font-size:2.1em;line-height:1.25;margin:0 0 .5em}
h2{margin-top:1.9em;border-bottom:1px solid var(--line);padding-bottom:.3em}
a{color:var(--accent)}
img{max-width:100%;height:auto;border-radius:8px}
pre{background:var(--surface);padding:14px;border-radius:8px;overflow-x:auto;border:1px solid var(--line)}
code{background:var(--surface);padding:2px 6px;border-radius:4px;font-size:.9em}
pre code{background:none;padding:0;border:0}
blockquote{border-left:3px solid var(--accent);margin-left:0;padding-left:16px;color:var(--muted)}
table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left}
footer{border-top:1px solid var(--line);padding:22px 24px;color:var(--muted);font-size:14px;text-align:center}
</style>
</head>
<body>
<header><a class="brand" href="/">${escapeHtml(siteName)}</a>${nav ? `<nav>${nav}</nav>` : ''}</header>
<main>${params.body}</main>
<footer>${s.footer ?? escapeHtml(siteName)}</footer>
</body>
</html>
`
}

/** 按 Host 找到租户站点；找不到返回 null（由调用方决定 404 还是渲染平台首页） */
async function resolveSite(prisma: PrismaClient, req: FastifyRequest, platformDomain: string) {
  let lookup: { slug?: string; domain?: string }
  try {
    lookup = parseHost(req.headers.host ?? '', platformDomain)
  } catch {
    return null
  }
  if (!lookup.slug && !lookup.domain) return null

  const site = await prisma.site.findFirst({
    where: {
      archivedAt: null,
      ...(lookup.slug
        ? { slug: lookup.slug }
        : // 自定义域名必须已验证才生效，否则任何人绑一个域名就能劫持渲染
          { domain: lookup.domain, domainVerifiedAt: { not: null } }),
    },
    include: { workspace: { select: { customDomainEnabled: true } } },
  })
  if (!site) return null

  // 租户未获授权时，自定义域名不生效
  if (lookup.domain && !site.workspace.customDomainEnabled) return null
  return site
}

export async function publicSiteRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  platformDomain: string,
): Promise<void> {
  /** 租户 sitemap：只含已发布内容 */
  app.get('/sitemap.xml', async (req, reply) => {
    const site = await resolveSite(prisma, req, platformDomain)
    if (!site) return reply.callNotFound()

    const origin = siteOrigin({ ...site, platformDomain })
    const contents = await prisma.content.findMany({
      where: { siteId: site.id, status: 'published' },
      select: { path: true, publishedAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 50_000,
    })

    const urls = contents
      .map((c) => {
        const loc = `${origin}${c.path === '/' ? '/' : `${c.path}/`}`
        const lastmod = (c.publishedAt ?? c.updatedAt).toISOString().slice(0, 10)
        return `  <url>\n    <loc>${escapeHtml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`
      })
      .join('\n')

    return reply
      .type('application/xml; charset=utf-8')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      )
  })

  app.get('/robots.txt', async (req, reply) => {
    const site = await resolveSite(prisma, req, platformDomain)
    if (!site) return reply.callNotFound()
    const origin = siteOrigin({ ...site, platformDomain })
    return reply
      .type('text/plain; charset=utf-8')
      .send(`User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`)
  })

  /**
   * 内容页渲染。
   *
   * 注册为最低优先级的通配路由，因此 /api/v1/*、/console 等
   * 已注册的具体路由不会被它拦截。
   */
  app.get('/*', async (req, reply) => {
    const site = await resolveSite(prisma, req, platformDomain)
    if (!site) return reply.callNotFound()

    const raw = (req.params as { '*': string })['*'] ?? ''
    // 统一成规范化路径：去尾斜杠、补前导斜杠，与入库时保持一致
    const path = `/${raw}`.replace(/\/+$/, '').toLowerCase() || '/'

    const content = await prisma.content.findFirst({
      where: { siteId: site.id, path, status: 'published' },
      include: { currentVersion: true },
    })
    if (!content?.currentVersion) return reply.callNotFound()

    // 无尾斜杠的地址 301 到带斜杠版本，与 canonical 保持一致，
    // 避免同一内容存在两个可访问 URL（重复内容）
    const requestPath = (req.raw.url ?? '/').split('?')[0]
    if (path !== '/' && !requestPath.endsWith('/')) {
      return reply.code(301).redirect(`${path}/`)
    }

    const origin = siteOrigin({ ...site, platformDomain })
    const settings = (site.settings ?? {}) as SiteSettings
    const version = content.currentVersion
    const parsed = parseContent({
      format: content.format,
      body: version.body,
      url: `${origin}${path}`,
    })
    const meta = parsed.doc.head

    const html = renderPage({
      settings: { siteName: site.name, ...settings },
      origin,
      path,
      title: meta.title ?? site.name,
      description: meta.description ?? settings.description ?? '',
      body: content.format === 'markdown' ? (parsed.renderedHtml ?? '') : version.body,
      lastmod: content.publishedAt ?? content.updatedAt,
      ogImage: meta.openGraph?.image,
    })

    return reply
      .type('text/html; charset=utf-8')
      // 已发布内容可被 CDN 缓存，但需能在更新后较快失效
      .header('cache-control', 'public, max-age=60, s-maxage=300')
      .send(html)
  })
}
