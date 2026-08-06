/**
 * Sitemap 生成（规格 §3.6）。
 *
 * 这是 Google 收录的主要途径：Google 不支持 IndexNow，
 * 只能通过 sitemap + robots.txt 声明 + Search Console 提交来加快发现。
 */

export interface SitemapEntry {
  loc: string
  lastmod?: Date
}

/** 单个 sitemap 文件的 URL 上限（协议规定 50000） */
export const MAX_URLS_PER_SITEMAP = 50_000

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 生成 sitemap XML。
 *
 * 只应包含可被索引的页面——已发布、无 noindex、返回 200。
 * 把不可索引的 URL 放进 sitemap 会降低 Google 对该 sitemap 的信任度。
 */
export function buildSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .slice(0, MAX_URLS_PER_SITEMAP)
    .map((e) => {
      const lastmod = e.lastmod ? `\n    <lastmod>${e.lastmod.toISOString().slice(0, 10)}</lastmod>` : ''
      return `  <url>\n    <loc>${escapeXml(e.loc)}</loc>${lastmod}\n  </url>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
}

/** 站点数量超限时生成 sitemap 索引 */
export function buildSitemapIndex(sitemapUrls: string[], lastmod?: Date): string {
  const stamp = lastmod ? `\n    <lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ''
  const items = sitemapUrls
    .map((u) => `  <sitemap>\n    <loc>${escapeXml(u)}</loc>${stamp}\n  </sitemap>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</sitemapindex>
`
}

/**
 * 生成 robots.txt。
 *
 * 声明 sitemap 位置是 Google 发现 sitemap 的标准方式，
 * 不需要每次都去 Search Console 手动提交。
 */
export function buildRobotsTxt(params: { sitemapUrl: string; allowAll?: boolean }): string {
  const rules = params.allowAll === false ? 'Disallow: /' : 'Allow: /'
  return `User-agent: *
${rules}

Sitemap: ${params.sitemapUrl}
`
}
