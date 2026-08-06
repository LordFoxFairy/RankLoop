import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Google Search Console 自动化：验证站点所有权 → 添加站点 → 提交 sitemap。
 *
 * 关键点：Site Verification API 支持 FILE 方式，而本项目本身就是静态站生成器，
 * 因此可以把验证文件写进构建产物一起部署，实现全自动验证——
 * 无需人工去控制台点按钮。
 *
 * 唯一需要人工的是首次准备凭据（服务账号 JSON），之后每次发布全自动。
 */

const VERIFICATION_API = 'https://www.googleapis.com/siteVerification/v1'
const SEARCH_CONSOLE_API = 'https://www.googleapis.com/webmasters/v3'

export interface GscClient {
  request(params: {
    url: string
    method?: string
    data?: unknown
  }): Promise<{ data: unknown; status: number }>
}

export interface VerificationToken {
  token: string
  method: 'FILE' | 'META'
}

/**
 * 取得验证令牌。
 *
 * FILE 方式返回一个形如 `google1234abcd.html` 的文件名，
 * 内容为 `google-site-verification: <文件名>`。
 */
export async function getVerificationToken(
  client: GscClient,
  siteUrl: string,
  method: 'FILE' | 'META' = 'FILE',
): Promise<VerificationToken> {
  const res = await client.request({
    url: `${VERIFICATION_API}/token`,
    method: 'POST',
    data: {
      site: { type: 'SITE', identifier: siteUrl },
      verificationMethod: method,
    },
  })
  const token = (res.data as { token?: string }).token
  if (!token) throw new Error('Site Verification API 未返回 token')
  return { token, method }
}

/** 把 FILE 验证令牌写入构建产物，随站点一起部署 */
export function writeVerificationFile(outDir: string, token: string): string {
  // token 本身就是文件名，内容是固定格式的一行文本
  writeFileSync(join(outDir, token), `google-site-verification: ${token}\n`, 'utf8')
  return token
}

/**
 * 请求 Google 校验令牌。
 *
 * 必须在验证文件已经可以被公网访问之后调用，否则 Google 抓不到会失败。
 */
export async function verifySite(
  client: GscClient,
  siteUrl: string,
  method: 'FILE' | 'META' = 'FILE',
): Promise<void> {
  await client.request({
    url: `${VERIFICATION_API}/webResource?verificationMethod=${method}`,
    method: 'POST',
    data: { site: { type: 'SITE', identifier: siteUrl } },
  })
}

/** 把站点加入 Search Console。已存在时 Google 返回成功，因此可重复调用 */
export async function addSite(client: GscClient, siteUrl: string): Promise<void> {
  await client.request({
    url: `${SEARCH_CONSOLE_API}/sites/${encodeURIComponent(siteUrl)}`,
    method: 'PUT',
  })
}

/** 提交 sitemap。同一 sitemap 重复提交是幂等的 */
export async function submitSitemap(
  client: GscClient,
  siteUrl: string,
  sitemapUrl: string,
): Promise<void> {
  await client.request({
    url: `${SEARCH_CONSOLE_API}/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
    method: 'PUT',
  })
}

/** 查询站点在 Search Console 中的状态，用于确认自动化是否真的生效 */
export async function getSitemapStatus(
  client: GscClient,
  siteUrl: string,
  sitemapUrl: string,
): Promise<{ submitted: boolean; lastDownloaded?: string; warnings?: number; errors?: number }> {
  try {
    const res = await client.request({
      url: `${SEARCH_CONSOLE_API}/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
    })
    const d = res.data as {
      lastDownloaded?: string
      warnings?: string
      errors?: string
    }
    return {
      submitted: true,
      lastDownloaded: d.lastDownloaded,
      warnings: Number(d.warnings ?? 0),
      errors: Number(d.errors ?? 0),
    }
  } catch {
    return { submitted: false }
  }
}

export interface AutomationResult {
  step: string
  ok: boolean
  detail: string
}

/**
 * 完整自动化流程。
 *
 * 分步返回结果而非抛异常：某一步失败（如首次运行时验证文件还没上线）
 * 不应让整个发布流程失败，而应如实报告到了哪一步（规格 §0 第 10 条）。
 */
export async function runGscAutomation(params: {
  client: GscClient
  siteUrl: string
  sitemapUrl: string
  outDir?: string
  /** 首次运行需要先写验证文件并部署，第二次运行才能完成验证 */
  writeTokenOnly?: boolean
}): Promise<AutomationResult[]> {
  const results: AutomationResult[] = []
  const { client, siteUrl, sitemapUrl } = params

  // 1. 取验证令牌并写入产物
  if (params.outDir) {
    try {
      const { token } = await getVerificationToken(client, siteUrl, 'FILE')
      writeVerificationFile(params.outDir, token)
      results.push({ step: '生成验证文件', ok: true, detail: `${siteUrl}/${token}` })
    } catch (e) {
      results.push({ step: '生成验证文件', ok: false, detail: (e as Error).message })
      return results
    }
  }

  if (params.writeTokenOnly) return results

  // 2. 请求校验（验证文件需已可公网访问）
  try {
    await verifySite(client, siteUrl, 'FILE')
    results.push({ step: '验证所有权', ok: true, detail: '已验证' })
  } catch (e) {
    results.push({
      step: '验证所有权',
      ok: false,
      detail: `${(e as Error).message}（验证文件可能尚未部署，下次发布会重试）`,
    })
    return results
  }

  // 3. 加入 Search Console
  try {
    await addSite(client, siteUrl)
    results.push({ step: '添加站点', ok: true, detail: siteUrl })
  } catch (e) {
    results.push({ step: '添加站点', ok: false, detail: (e as Error).message })
  }

  // 4. 提交 sitemap
  try {
    await submitSitemap(client, siteUrl, sitemapUrl)
    results.push({ step: '提交 sitemap', ok: true, detail: sitemapUrl })
  } catch (e) {
    results.push({ step: '提交 sitemap', ok: false, detail: (e as Error).message })
  }

  // 5. 回读状态确认真的生效
  const status = await getSitemapStatus(client, siteUrl, sitemapUrl)
  results.push({
    step: '确认 sitemap 状态',
    ok: status.submitted,
    detail: status.submitted
      ? `已收录 · 错误 ${status.errors ?? 0} · 警告 ${status.warnings ?? 0}${
          status.lastDownloaded ? ` · 最近抓取 ${status.lastDownloaded}` : ' · 尚未抓取'
        }`
      : 'Google 尚未记录该 sitemap',
  })

  return results
}
