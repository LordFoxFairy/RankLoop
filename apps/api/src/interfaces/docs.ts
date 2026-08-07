import type { FastifyInstance } from 'fastify'

/**
 * 开发者文档页。
 *
 * 直接把 openapi.json 甩给用户是很差的体验——原始 JSON 无法阅读。
 * 这里提供人类可读的接入说明；原始 schema 仍保留在
 * /api/v1/openapi.json 供工具链消费。
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface Endpoint {
  method: string
  path: string
  scope: string
  desc: string
}

const GROUPS: Array<{ title: string; intro: string; items: Endpoint[] }> = [
  {
    title: '内容',
    intro: '提交、更新、发布内容。每次提交都会返回检测结果。',
    items: [
      { method: 'POST', path: '/sites/{siteId}/contents', scope: 'contents:write', desc: '提交新内容并立即检测' },
      { method: 'PUT', path: '/contents/{contentId}', scope: 'contents:write', desc: '更新内容，产生新版本并重新检测' },
      { method: 'POST', path: '/contents/{contentId}/publish', scope: 'contents:publish', desc: '发布；存在 critical 问题时返回 422' },
      { method: 'GET', path: '/contents/{contentId}', scope: 'contents:read', desc: '查看内容与最新检测结果' },
      { method: 'GET', path: '/contents/{contentId}/versions', scope: 'contents:read', desc: '版本历史与分数变化' },
      { method: 'POST', path: '/contents/check', scope: 'contents:write', desc: '无状态预检，不落库' },
    ],
  },
  {
    title: '站点与域名',
    intro: '管理站点、绑定自有域名。绑定后内容以该域名对外渲染。',
    items: [
      { method: 'GET', path: '/sites', scope: 'sites:read', desc: '列出站点' },
      { method: 'POST', path: '/sites', scope: 'sites:write', desc: '创建站点' },
      { method: 'GET', path: '/sites/{siteId}', scope: 'sites:read', desc: '站点详情与访问地址' },
      { method: 'PATCH', path: '/sites/{siteId}', scope: 'sites:write', desc: '更新站点名、slug 与展示配置' },
      { method: 'POST', path: '/sites/{siteId}/domain', scope: 'sites:write', desc: '绑定自有域名，返回 DNS 配置指引' },
      { method: 'POST', path: '/sites/{siteId}/domain/verify', scope: 'sites:write', desc: '验证域名归属' },
    ],
  },
  {
    title: '收录与统计',
    intro: 'sitemap、搜索引擎提交与健康分统计。',
    items: [
      { method: 'GET', path: '/sites/{siteId}/sitemap.xml', scope: 'indexing:read', desc: '站点 sitemap' },
      { method: 'POST', path: '/sites/{siteId}/indexnow/submit', scope: 'indexing:write', desc: '提交 URL 到 IndexNow' },
      { method: 'GET', path: '/sites/{siteId}/indexing-status', scope: 'indexing:read', desc: '每条内容的收录提交状态' },
      { method: 'GET', path: '/stats/overview', scope: 'contents:read', desc: '健康分与问题分布' },
      { method: 'GET', path: '/stats/trend', scope: 'contents:read', desc: '30 天分数趋势' },
    ],
  },
]

const METHOD_COLOR: Record<string, string> = {
  GET: 'var(--ok)',
  POST: 'var(--accent)',
  PUT: 'var(--warn)',
  PATCH: 'var(--warn)',
  DELETE: 'var(--crit)',
}

export function renderDocs(ruleCount: number): string {
  const groups = GROUPS.map(
    (g) => `<section class="grp">
<h2>${escapeHtml(g.title)}</h2>
<p class="intro">${escapeHtml(g.intro)}</p>
<table>
<thead><tr><th>接口</th><th>说明</th><th>权限</th></tr></thead>
<tbody>${g.items
      .map(
        (e) => `<tr>
  <td><span class="m" style="color:${METHOD_COLOR[e.method] ?? 'var(--muted)'}">${e.method}</span>
      <code>${escapeHtml(e.path)}</code></td>
  <td>${escapeHtml(e.desc)}</td>
  <td><code class="sc">${escapeHtml(e.scope)}</code></td>
</tr>`,
      )
      .join('')}</tbody>
</table>
</section>`,
  ).join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>开发者文档 — RankLoop</title>
<meta name="description" content="RankLoop 接入文档：用 API Key 提交内容，立即获得 ${ruleCount} 条 SEO 规则的检测结果与修复建议，修复后重新提交并发布，达标内容自动进入 sitemap。">
<link rel="canonical" href="/docs">
<style>
:root{color-scheme:light dark;--fg:#0d1117;--bg:#fff;--muted:#5b6472;--line:#e6e9ee;
 --surface:#f7f8fa;--accent:#1a5fd0;--ok:#067647;--warn:#b54708;--crit:#b42318;--max:900px}
@media(prefers-color-scheme:dark){:root{--fg:#e8ebf0;--bg:#0c0f14;--muted:#9aa4b2;
 --line:#232833;--surface:#131720;--accent:#5b9bf8}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
 font:16px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
a{color:var(--accent)}
.wrap{max-width:var(--max);margin:0 auto;padding:0 24px}
header{border-bottom:1px solid var(--line);background:var(--bg)}
header .wrap{display:flex;align-items:center;gap:22px;height:60px}
.logo{display:flex;align-items:center;gap:9px;font-weight:700;color:var(--fg);
 text-decoration:none;font-size:17px}
.logo svg{width:25px;height:25px}
header nav{margin-left:auto;display:flex;gap:22px}
header nav a{color:var(--muted);text-decoration:none;font-size:14.5px}
header nav a:hover{color:var(--fg)}
h1{font-size:2rem;margin:44px 0 12px;letter-spacing:-.02em}
.lead{color:var(--muted);margin:0 0 34px;font-size:16.5px}
h2{font-size:1.28rem;margin:44px 0 8px;letter-spacing:-.01em}
.intro{color:var(--muted);font-size:14.8px;margin:0 0 16px}
.step{background:var(--surface);border:1px solid var(--line);border-radius:12px;
 padding:20px 22px;margin-bottom:14px}
.step h3{margin:0 0 8px;font-size:15.5px}
.step p{margin:0 0 10px;color:var(--muted);font-size:14.5px}
pre{background:var(--surface);border:1px solid var(--line);border-radius:10px;
 padding:15px 17px;overflow-x:auto;font-size:13px;line-height:1.65;margin:0;
 font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.step pre{background:var(--bg)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
table{width:100%;border-collapse:collapse;font-size:14px;display:block;overflow-x:auto}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);
 vertical-align:top;white-space:nowrap}
td:nth-child(2){white-space:normal;color:var(--muted)}
th{font-size:12.5px;color:var(--muted);font-weight:500}
.m{font-weight:700;font-size:12px;margin-right:7px;font-family:ui-monospace,monospace}
.sc{font-size:12px;color:var(--muted);background:var(--surface);padding:2px 7px;border-radius:5px}
.note{border-left:3px solid var(--accent);padding:2px 0 2px 15px;margin:22px 0;
 color:var(--muted);font-size:14.8px}
footer{border-top:1px solid var(--line);margin-top:60px;padding:28px 0;
 color:var(--muted);font-size:14px}
footer a{color:var(--muted);text-decoration:none;margin-left:18px}
</style>
</head>
<body>

<header><div class="wrap">
  <a class="logo" href="/">
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--accent)"/>
      <path d="M9 21V11h6a3 3 0 0 1 0 6h-3l5 4" stroke="#fff" stroke-width="2.4"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    RankLoop
  </a>
  <nav><a href="/">首页</a><a href="/skills">AI Agent</a><a href="/console">控制台</a></nav>
</div></header>

<div class="wrap">
  <h1>开发者文档</h1>
  <p class="lead">
    把内容推送到平台，拿到 ${ruleCount} 条规则的检测结果，修复后重新提交并发布。
  </p>

  <h2>三步接入</h2>

  <div class="step">
    <h3>1 · 获取 API Key</h3>
    <p>在<a href="/console">控制台</a>创建。明文只显示一次，请立即保存。</p>
    <pre>Authorization: Bearer rkl_live_xxxxxxxxxxxx</pre>
  </div>

  <div class="step">
    <h3>2 · 提交内容</h3>
    <p>支持 HTML 与 Markdown。Markdown 的元数据通过 frontmatter 提供。</p>
    <pre>curl -X POST "https://<span style="color:var(--accent)">你的域名</span>/api/v1/sites/{siteId}/contents" \\
  -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"path":"/article","format":"markdown","body":"---\\ntitle: 标题\\n---\\n\\n# 正文"}'</pre>
  </div>

  <div class="step">
    <h3>3 · 按返回结果修复并发布</h3>
    <p>检测不通过时返回规则编码、触发证据与修复建议，据此修改后重新提交。</p>
    <pre>{ "score": 0, "publishable": false,
  "issues": [{ "code": "MISSING_TITLE",
               "evidence": "title 为空或未提供",
               "recommendation": "添加 10-60 字符的标题，包含核心关键词。" }] }</pre>
  </div>

  <div class="note">
    存在 critical 级别问题时，发布接口返回 <code>422 SEO_GATE_FAILED</code>，
    并在 <code>details.blocking</code> 中列出阻塞规则。修复后重新提交即可发布。
  </div>

  ${groups}

  <h2>响应格式</h2>
  <p class="intro">成功与错误使用统一结构，便于自动化处理。</p>
  <pre>// 成功
{ "data": { ... }, "meta": { "request_id": "req_..." } }

// 错误
{ "error": { "code": "SEO_GATE_FAILED",
             "message": "内容存在严重 SEO 问题，无法发布",
             "details": { "blocking": ["MISSING_TITLE"], "score": 13 } },
  "meta": { "request_id": "req_..." } }</pre>

  <div class="note">
    完整机器可读 schema：<a href="/api/v1/openapi.json">OpenAPI 3.1</a>，
    可直接导入 Postman 或用于生成客户端。
  </div>
</div>

<footer><div class="wrap">
  RankLoop SEO
  <span style="float:right">
    <a href="/">首页</a><a href="/console">控制台</a><a href="/api/v1/rules">规则清单</a>
  </span>
</div></footer>

</body>
</html>
`
}

export async function docsRoutes(app: FastifyInstance, ruleCount: number): Promise<void> {
  const html = renderDocs(ruleCount)
  app.get('/docs', async (_req, reply) => reply.type('text/html; charset=utf-8').send(html))
}
