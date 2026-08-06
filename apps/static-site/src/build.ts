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
<header><a href="/">${escapeHtml(params.siteName)}</a></header>
<main>${params.body}</main>
<footer>由 <a href="https://github.com/LordFoxFairy/RankLoop">RankLoop</a> 生成 · SEO 检测通过</footer>
</body>
</html>
`

export function build(options: BuildOptions): BuildResult {
  const files = walk(options.contentDir)
  const pages: PageResult[] = []

  for (const file of files) {
    const raw = readFileSync(file, 'utf8')
    const format = extname(file) === '.html' ? 'html' : 'markdown'
    const urlPath = toUrlPath(file, options.contentDir)
    const canonical = `${options.siteUrl}${urlPath}`

    const parsed = parseContent({ format, body: raw, url: canonical })
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

    const html =
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
            jsonLd: (parsed.doc.jsonLd ?? [])[0] ?? '',
            body: parsed.renderedHtml ?? '',
          })

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
