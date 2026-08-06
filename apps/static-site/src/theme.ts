import type { SiteConfig } from './config'

/**
 * 页面模板。
 *
 * 所有外观由 rankloop.config.json 驱动，改配色、导航、首页布局都不需要动代码。
 * 不引入渲染框架（Astro/Next）：本项目的核心价值是 SEO 规则引擎与发布门槛，
 * 渲染只需输出语义正确的 HTML；引入框架会带来构建复杂度与版本维护成本，
 * 与「单容器/零依赖一键部署」冲突。
 */

/**
 * 站内链接补尾斜杠。
 *
 * 静态托管把 /rules 301 到 /rules/，站内链接若不带斜杠，
 * 每次点击都会多一跳；Google 也会把两种形式视作不同 URL。
 * 已带斜杠、指向文件（含扩展名）、或外链的地址保持不变。
 */
function withTrailingSlash(href: string): string {
  if (!href.startsWith('/')) return href
  if (href.endsWith('/')) return href
  if (/\.[a-z0-9]{2,5}$/i.test(href)) return href
  if (href.includes('#') || href.includes('?')) return href
  return `${href}/`
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function styles(config: SiteConfig): string {
  const t = config.theme
  const scheme =
    t.colorScheme === 'light' ? 'light' : t.colorScheme === 'dark' ? 'dark' : 'light dark'

  const darkBlock =
    t.colorScheme === 'light'
      ? ''
      : `@media(prefers-color-scheme:dark){:root{--fg:#e6e9ef;--bg:#12151a;--muted:#98a2b3;--line:#272c37;--surface:#171a21}}`

  return `:root{
  color-scheme:${scheme};
  --fg:#1a1d23;--bg:#fff;--muted:#5b6472;--line:#e4e7ec;--surface:#f7f8fa;
  --accent:${t.accent};
  --width:${t.contentWidth};
}
${darkBlock}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
 font:16px/1.75 ${t.fontFamily}}
header{border-bottom:1px solid var(--line);padding:14px 24px;
 display:flex;align-items:center;gap:22px;flex-wrap:wrap}
header .brand{color:var(--fg);text-decoration:none;font-weight:680;font-size:17px}
header nav{display:flex;gap:18px;flex-wrap:wrap}
header nav a{color:var(--muted);text-decoration:none;font-size:14px}
header nav a:hover{color:var(--accent)}
main{max-width:var(--width);margin:0 auto;padding:40px 24px 64px}
h1{font-size:2.1em;line-height:1.25;margin:0 0 .5em;letter-spacing:-.01em}
h2{margin-top:1.9em;border-bottom:1px solid var(--line);padding-bottom:.3em}
h3{margin-top:1.5em}
a{color:var(--accent)}
img{max-width:100%;height:auto;border-radius:8px}
pre{background:var(--surface);padding:14px;border-radius:8px;overflow-x:auto;
 border:1px solid var(--line)}
code{background:var(--surface);padding:2px 6px;border-radius:4px;font-size:.9em}
pre code{background:none;padding:0;border:0}
blockquote{border-left:3px solid var(--accent);margin-left:0;padding-left:16px;color:var(--muted)}
table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left}
footer{border-top:1px solid var(--line);padding:22px 24px;color:var(--muted);
 font-size:14px;text-align:center}
.hero{padding:16px 0 30px;border-bottom:1px solid var(--line);margin-bottom:30px}
.hero h1{font-size:2.6em;margin-bottom:.3em}
.hero p{font-size:1.15em;color:var(--muted);margin:0 0 1.4em}
.actions{display:flex;gap:12px;flex-wrap:wrap}
.actions a{display:inline-block;padding:9px 20px;border-radius:8px;
 text-decoration:none;font-size:15px;font-weight:520;
 border:1px solid var(--line);color:var(--fg)}
.actions a.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
@media(max-width:640px){h1{font-size:1.7em}.hero h1{font-size:2em}}`
}

function navHtml(config: SiteConfig, basePath: string): string {
  if (config.nav.length === 0) return ''
  const items = config.nav
    .map((n) => {
      const href = withTrailingSlash(n.href.startsWith('/') ? `${basePath}${n.href}` : n.href)
      return `<a href="${escapeHtml(href)}">${escapeHtml(n.label)}</a>`
    })
    .join('')
  return `<nav>${items}</nav>`
}

function heroHtml(config: SiteConfig, basePath: string): string {
  const hero = config.home
  if (!hero?.title && !hero?.subtitle) return ''

  const actions = (hero.actions ?? [])
    .map((a) => {
      const href = withTrailingSlash(a.href.startsWith('/') ? `${basePath}${a.href}` : a.href)
      return `<a href="${escapeHtml(href)}"${a.primary ? ' class="primary"' : ''}>${escapeHtml(a.label)}</a>`
    })
    .join('')

  return `<div class="hero">
${hero.title ? `<h1>${escapeHtml(hero.title)}</h1>` : ''}
${hero.subtitle ? `<p>${escapeHtml(hero.subtitle)}</p>` : ''}
${actions ? `<div class="actions">${actions}</div>` : ''}
</div>`
}

export interface RenderParams {
  config: SiteConfig
  basePath: string
  title: string
  description: string
  canonical: string
  lang: string
  og: Record<string, string>
  jsonLd: string
  body: string
  /** 首页使用 hero 布局 */
  isHome: boolean
}

/**
 * 首页启用 hero 时，hero 的 H1 与正文 H1 会同时存在，产生两个 H1。
 * 多个 H1 会稀释页面主题，也与本项目自己的 MULTIPLE_H1 规则冲突——
 * 规则跑在 Markdown 阶段，看不到模板注入的标题，因此必须在渲染层消除。
 */
function demoteBodyH1(body: string): string {
  return body.replace(/<h1(\s[^>]*)?>/gi, '<h2$1>').replace(/<\/h1>/gi, '</h2>')
}

export function renderPage(p: RenderParams): string {
  const { config } = p
  const brandHref = p.basePath ? `${p.basePath}/` : '/'
  const usesHero = p.isHome && Boolean(config.home?.title)
  const body = usesHero ? demoteBodyH1(p.body) : p.body

  return `<!doctype html>
<html lang="${escapeHtml(p.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(p.title)}</title>
<meta name="description" content="${escapeHtml(p.description)}">
<link rel="canonical" href="${escapeHtml(p.canonical)}">
<meta property="og:type" content="${p.isHome ? 'website' : 'article'}">
<meta property="og:site_name" content="${escapeHtml(config.siteName)}">
<meta property="og:title" content="${escapeHtml(p.og.title ?? p.title)}">
<meta property="og:description" content="${escapeHtml(p.og.description ?? p.description)}">
<meta property="og:url" content="${escapeHtml(p.canonical)}">
${p.og.image ? `<meta property="og:image" content="${escapeHtml(p.og.image)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
${p.jsonLd ? `<script type="application/ld+json">${p.jsonLd}</script>` : ''}
<style>${styles(config)}</style>
${config.headExtra ?? ''}
</head>
<body>
<header>
<a class="brand" href="${escapeHtml(brandHref)}">${escapeHtml(config.siteName)}</a>
${navHtml(config, p.basePath)}
</header>
<main>
${p.isHome ? heroHtml(config, p.basePath) : ''}
${body}
</main>
<footer>${config.footer ?? `由 <a href="https://github.com/LordFoxFairy/RankLoop">RankLoop</a> 生成 · SEO 检测通过`}</footer>
</body>
</html>
`
}
