/**
 * URL 与路径规范化（规格 §6、§13.1）。
 *
 * 规范化决定唯一性约束是否可靠：若 `/a` 与 `/a/` 被当作两条内容，
 * 同一页面会产生重复记录，SEO 上等同于重复内容问题。
 */

/** 规范化站点 origin：小写 scheme 与 host，去掉默认端口 */
export function normalizeOrigin(input: string): string {
  const url = new URL(input)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`不支持的协议：${url.protocol}`)
  }
  const isDefaultPort =
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  const port = isDefaultPort || !url.port ? '' : `:${url.port}`
  return `${url.protocol}//${url.hostname.toLowerCase()}${port}`
}

/**
 * 规范化内容路径。
 *
 * 必须阻断 `..` —— 托管内容的 path 会参与最终 URL 拼接，
 * 放任穿越可让第三方把内容挂到其他站点的路径下。
 */
export function normalizePath(input: string): string {
  let path = input.trim()
  if (!path.startsWith('/')) path = `/${path}`

  // 先解码，避免 %2e%2e 绕过检测
  try {
    path = decodeURIComponent(path)
  } catch {
    throw new Error('路径包含无效的百分号编码')
  }

  if (path.includes('\0')) throw new Error('路径包含空字节')

  const segments = path.split('/').filter((s) => s.length > 0)
  if (segments.some((s) => s === '..' || s === '.')) {
    throw new Error('路径不得包含相对片段')
  }

  const normalized = `/${segments.join('/')}`
  return normalized.toLowerCase()
}

/** 拼接内容的绝对 URL，供 canonical 判定与 IndexNow 提交使用 */
export function contentUrl(origin: string, path: string): string {
  return `${normalizeOrigin(origin)}${normalizePath(path)}`
}

/** IndexNow 只接受属于本站点的 URL（规格 §3.7） */
export function belongsToSite(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === normalizeOrigin(origin)
  } catch {
    return false
  }
}
