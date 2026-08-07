import type { GscClient } from './gsc-sync'

/**
 * 向 Google Search Console 提交 sitemap。
 *
 * Google 不支持 IndexNow，但支持通过 Search Console API 提交 sitemap——
 * 这是「让 Google 尽快发现新内容」在 Google 侧唯一的主动手段。
 * 此前落地页宣称「自动提交 Search Console」，实际代码只用了
 * webmasters.readonly（只读），从未提交过，属于夸大宣传。
 *
 * 注意边界：提交 sitemap 只是「告知」，Google 官方明确说明
 * 抓取需数天至数周且不保证收录，更不保证排名。
 */

/** 提交 sitemap 需要写权限，只读 scope 会被拒 */
export const GSC_WRITE_SCOPE = 'https://www.googleapis.com/auth/webmasters'

const GSC_API = 'https://www.googleapis.com/webmasters/v3'

export interface SitemapSubmitResult {
  submitted: boolean
  sitemapUrl: string
  error?: string
}

/**
 * 提交单个站点的 sitemap。
 *
 * 失败如实返回而不抛出——调用方通常在批量循环里，
 * 单站失败（多为服务账号未被加为该属性的用户）不该中断其他站点。
 */
export async function submitSitemap(params: {
  client: GscClient
  siteUrl: string
  sitemapUrl: string
}): Promise<SitemapSubmitResult> {
  const { siteUrl, sitemapUrl } = params

  try {
    await params.client.request({
      url: `${GSC_API}/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
      method: 'PUT',
    })
    return { submitted: true, sitemapUrl }
  } catch (e) {
    return { submitted: false, sitemapUrl, error: (e as Error).message }
  }
}

/** 站点的 sitemap 地址，与 public-site 渲染的路径保持一致 */
export function sitemapUrlFor(siteOrigin: string): string {
  return `${siteOrigin.replace(/\/$/, '')}/sitemap.xml`
}
