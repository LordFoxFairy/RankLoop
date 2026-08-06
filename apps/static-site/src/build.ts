import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { parseContent, runRules } from '@rankloop/seo-rules'

/**
 * 静态站生成器。
 *
 * 把 content/ 下的 Markdown 编译成静态 HTML + sitemap.xml + robots.txt，
 * 由 GitHub Pages 托管——全程零成本，不需要服务器与数据库。
 *
 * SEO 门槛在此强制执行：存在 critical 问题的内容不会被构建进站点，
 * 与 API 版本的发布门槛保持同一套规则（packages/seo-rules）。
 */

export interface BuildOptions {
  contentDir: string
  outDir: string
  /** 站点根地址，用于 canonical、sitemap 与内链判定 */
  siteUrl: string
  siteName: string
  /** true 时即使有 critical 问题也照常输出，用于本地预览 */
  ignoreGate?: boolean
  /** 内容未指定 og:image 时使用的默认图 */
  defaultOgImage?: string
}

export interface PageResult {
  path: string
  url: string
  title: string
  description: string
  score: number
  blocking: string[]
  published: boolean
  lastmod: Date
}

export interface BuildResult {
  pages: PageResult[]
  built: number
  blocked: number
  averageScore: number | null
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 把根相对链接改写成带 base path 的形式。
 *
 * 站点部署在子路径（如 GitHub Pages 的 /RankLoop/）时，正文里的 `/about`
 * 会被浏览器和 Googlebot 解析成 `域名/about` —— 全是 404。
 * 满页死链会被 Google 判定为低质量站点，严重影响收录与排名。
 * 部署在根域名（如 Cloudflare Pages）时 basePath 为空，此函数不做改动。
 */
function rewriteLinks(html: string, basePath: string): string {
  if (!basePath) return html
  // 只改写以单个 / 开头的站内链接；// 开头是协议相对的外链，不能动
  return html
    .replace(/(<a\b[^>]*\bhref=")\/(?!\/)/g, `$1${basePath}/`)
    .replace(/(<img\b[^>]*\bsrc=")\/(?!\/)/g, `$1${basePath}/`)
}

/**
 * 生成 Article 结构化数据。
 *
 * Google 用 JSON-LD 判断页面类型与主题，是获得富媒体搜索结果的前提。
 * 内容自带 JSON-LD 时以其为准，否则按 Article 类型自动生成。
 */
function buildJsonLd(params: {
  title: string
  description: string
  canonical: string
  siteName: string
  siteUrl: string
  lastmod: Date
  image?: string
}): string {
  const json = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: params.title,
    description: params.description,
    mainEntityOfPage: { '@type': 'WebPage', '@id': params.canonical },
    url: params.canonical,
    dateModified: params.lastmod.toISOString(),
    ...(params.image ? { image: params.image } : {}),
    publisher: {
      '@type': 'Organization',
      name: params.siteName,
      url: params.siteUrl,
    },
    inLanguage: 'zh-CN',
  })

  // 标题里的 </script> 会提前闭合 JSON-LD 标签，后续内容被当成可执行 JS。
  // 把所有 < 转成 \u003c：JSON.parse 后仍还原为 <，但在 HTML 解析阶段
  // 不再构成标签边界，因此无法逃逸出 script 块。
  return json.replace(/</g, '\\u003c')
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (['.md', '.markdown', '.html'].includes(extname(entry))) out.push(full)
  }
  return out
}

/** content/foo/bar.md → /foo/bar；index 映射到目录根 */
function toUrlPath(file: string, contentDir: string): string {
  const rel = relative(contentDir, file).replace(/\\/g, '/')
  const noExt = rel.replace(/\.(md|markdown|html)$/, '')
  const cleaned = noExt.replace(/(^|\/)index$/, '')
  return `/${cleaned}`.replace(/\/+$/, '') || '/'
}

const LAYOUT = (params: {
  siteName: string
  siteUrl: string
  url: string
  title: string
  description: string
  canonical: string
  lang: string
  og: Record<string, string>
  jsonLd: string
  body: string
  basePath: string
}) => `<!doctype html>
<html lang="${escapeHtml(params.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(params.title)}</title>
<meta name="description" content="${escapeHtml(params.description)}">
<link rel="canonical" href="${escapeHtml(params.canonical)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(params.og.title ?? params.title)}">
<meta property="og:description" content="${escapeHtml(params.og.description ?? params.description)}">
<meta property="og:url" content="${escapeHtml(params.canonical)}">
${params.og.image ? `<meta property="og:image" content="${escapeHtml(params.og.image)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
${params.jsonLd ? `<script type="application/ld+json">${params.jsonLd}</script>` : ''}
<style>
:root{color-scheme:light dark;--fg:#1a1d23;--bg:#fff;--muted:#5b6472;--line:#e4e7ec;--accent:#0b62d0}
@media(prefers-color-scheme:dark){:root{--fg:#e6e9ef;--bg:#12151a;--muted:#98a2b3;--line:#272c37;--accent:#6aa9f5}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
 font:16px/1.75 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
header,footer{border-color:var(--line)}
header{border-bottom:1px solid var(--line);padding:16px 24px}
header a{color:var(--fg);text-decoration:none;font-weight:650}
main{max-width:760px;margin:0 auto;padding:36px 24px 60px}
h1{font-size:2em;line-height:1.25;margin:0 0 .6em}
h2{margin-top:1.8em;border-bottom:1px solid var(--line);padding-bottom:.3em}
a{color:var(--accent)}
img{max-width:100%;height:auto;border-radius:8px}
pre{background:rgba(127,127,127,.12);padding:14px;border-radius:8px;overflow-x:auto}
code{background:rgba(127,127,127,.12);padding:2px 6px;border-radius:4px;font-size:.9em}
pre code{background:none;padding:0}
blockquote{border-left:3px solid var(--accent);margin-left:0;padding-left:16px;color:var(--muted)}
table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--line);padding:8px 10px;text-align:left}
footer{border-top:1px solid var(--line);padding:20px 24px;color:var(--muted);font-size:14px;text-align:center}
</style>
</head>
<body>
<header><a href="${escapeHtml(params.basePath || '/')}">${escapeHtml(params.siteName)}</a></header>
<main>${params.body}</main>
<footer>由 <a href="https://github.com/LordFoxFairy/RankLoop">RankLoop</a> 生成 · SEO 检测通过</footer>
</body>
</html>
`

export function build(options: BuildOptions): BuildResult {
  const files = walk(options.contentDir)
  const pages: PageResult[] = []
  // 站点部署在子路径时（如 https://user.github.io/repo），需要改写站内链接
  const basePath = new URL(options.siteUrl).pathname.replace(/\/$/, '')

  for (const file of files) {
    const raw = readFileSync(file, 'utf8')
    const format = extname(file) === '.html' ? 'html' : 'markdown'
    const urlPath = toUrlPath(file, options.contentDir)
    const canonical = `${options.siteUrl}${urlPath}`

    const parsed = parseContent({ format, body: raw, url: canonical })

    // canonical 与 og:image 由构建时按 SITE_URL 注入，内容里不写死域名——
    // 否则换域名要改每一个文件，且换错就会触发 CANONICAL_CROSS_DOMAIN。
    // frontmatter 显式指定时以其为准（跨域归并等特殊场景）。
    parsed.doc.head.canonical ??= canonical
    if (options.defaultOgImage) {
      parsed.doc.head.openGraph = {
        ...(parsed.doc.head.openGraph ?? {}),
        image: parsed.doc.head.openGraph?.image ?? options.defaultOgImage,
      }
    }

    const check = runRules(parsed.doc)
    const blocking = check.issues.filter((i) => i.severity === 'critical').map((i) => i.code)
    const allowed = blocking.length === 0 || options.ignoreGate === true

    const result: PageResult = {
      path: urlPath,
      url: canonical,
      title: parsed.doc.head.title ?? basename(file),
      description: parsed.doc.head.description ?? '',
      score: check.score,
      blocking,
      published: allowed,
      lastmod: statSync(file).mtime,
    }
    pages.push(result)

    if (!allowed) continue

    const rendered =
      format === 'html'
        ? raw
        : LAYOUT({
            siteName: options.siteName,
            siteUrl: options.siteUrl,
            url: urlPath,
            title: result.title,
            description: result.description,
            // canonical 缺失时用页面自身地址兜底，避免重复内容问题
            canonical: parsed.doc.head.canonical ?? canonical,
            lang: parsed.doc.head.lang ?? 'zh-CN',
            og: parsed.doc.head.openGraph ?? {},
            jsonLd:
              (parsed.doc.jsonLd ?? [])[0] ??
              buildJsonLd({
                title: result.title,
                description: result.description,
                canonical: parsed.doc.head.canonical ?? canonical,
                siteName: options.siteName,
                siteUrl: options.siteUrl,
                lastmod: result.lastmod,
                image: parsed.doc.head.openGraph?.image,
              }),
            basePath,
            body: rewriteLinks(parsed.renderedHtml ?? '', basePath),
          })

    const html = format === 'html' ? rewriteLinks(rendered, basePath) : rendered

    const outFile = join(options.outDir, urlPath === '/' ? 'index.html' : `${urlPath}/index.html`)
    mkdirSync(join(outFile, '..'), { recursive: true })
    writeFileSync(outFile, html, 'utf8')
  }

  const built = pages.filter((p) => p.published)
  const averageScore =
    pages.length > 0 ? Math.round(pages.reduce((s, p) => s + p.score, 0) / pages.length) : null

  return {
    pages,
    built: built.length,
    blocked: pages.length - built.length,
    averageScore,
  }
}
