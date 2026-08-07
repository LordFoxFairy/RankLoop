import type { FastifyInstance } from 'fastify'

/**
 * AI Agent 接入页。
 *
 * 面向想用 AI 自动修 SEO 的用户：告诉他们社区里有哪些现成的
 * SEO skills / MCP server，以及如何把 RankLoop 接进去。
 *
 * 只列经过核实真实存在的仓库（star 数、最后提交、license 均已核对）。
 * 但 star 数只说明热度，不说明其中 SEO 建议的正确性——
 * 这些内容多为社区撰写且未经验证，页面上必须如实说明。
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface Repo {
  name: string
  url: string
  stars: string
  license: string
  desc: string
}

/** 社区 SEO skills。数据核对于 2026-08-07。 */
const SKILLS: Repo[] = [
  {
    name: 'AgriciDaniel/claude-seo',
    url: 'https://github.com/AgriciDaniel/claude-seo',
    stars: '13.6k',
    license: 'MIT',
    desc: '25 个子技能，覆盖技术 SEO、E-E-A-T、schema、GEO/AEO、国际化。把确定性校验器与提示词分开，结构较可靠。',
  },
  {
    name: 'coreyhaines31/marketingskills',
    url: 'https://github.com/coreyhaines31/marketingskills',
    stars: '43.4k',
    license: 'MIT',
    desc: '综合营销技能集，SEO 是其中一部分（ai-seo / programmatic-seo / seo-audit）。',
  },
  {
    name: 'every-app/open-seo',
    url: 'https://github.com/every-app/open-seo',
    stars: '10.8k',
    license: 'MIT',
    desc: '开源 SEO 套件，同时提供 skills：审计、关键词研究与聚类、竞品分析。',
  },
  {
    name: 'zubair-trabzada/geo-seo-claude',
    url: 'https://github.com/zubair-trabzada/geo-seo-claude',
    stars: '9.3k',
    license: 'MIT',
    desc: '面向 AI 搜索（GEO/AEO），附 6 个可复用的 JSON-LD 结构化数据模板。',
  },
]

/** SEO 相关 MCP server。 */
const MCPS: Repo[] = [
  {
    name: 'AminForou/mcp-gsc',
    url: 'https://github.com/AminForou/mcp-gsc',
    stars: '1.3k',
    license: 'MIT',
    desc: 'Google Search Console MCP，20 个工具：搜索表现、URL 检查、sitemap 管理。第三方项目，非 Google 官方。',
  },
  {
    name: 'dataforseo/mcp-server-typescript',
    url: 'https://github.com/dataforseo/mcp-server-typescript',
    stars: '237',
    license: 'Apache-2.0',
    desc: '厂商官方发布，提供 SERP、关键词、竞品数据。需付费账号。',
  },
  {
    name: 'danielsogl/lighthouse-mcp-server',
    url: 'https://github.com/danielsogl/lighthouse-mcp-server',
    stars: '66',
    license: 'MIT',
    desc: '封装 Lighthouse，做性能、可访问性与基础 SEO 审计。',
  },
]

function repoTable(rows: Repo[]): string {
  return (
    '<table><thead><tr><th>仓库</th><th>说明</th><th>Star</th><th>License</th></tr></thead><tbody>' +
    rows
      .map(
        (r) =>
          `<tr><td><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">` +
          `${escapeHtml(r.name)}</a></td>` +
          `<td>${escapeHtml(r.desc)}</td>` +
          `<td>${escapeHtml(r.stars)}</td>` +
          `<td>${escapeHtml(r.license)}</td></tr>`,
      )
      .join('') +
    '</tbody></table>'
  )
}

export function renderSkills(ruleCount: number): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>接入 AI Agent — RankLoop</title>
<meta name="description" content="把 RankLoop 的 ${ruleCount} 条 SEO 规则接入 AI Agent：检测出问题后由 AI 自动修复并重新提交，形成闭环。">
<link rel="canonical" href="/skills">
<meta property="og:type" content="article">
<meta property="og:title" content="接入 AI Agent — RankLoop">
<meta property="og:description" content="RankLoop 检测出问题并给出结构化建议，AI 负责修复并重新提交。">
<meta property="og:image" content="/img/og-cover.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'TechArticle',
  headline: '接入 AI Agent — RankLoop',
  description: 'RankLoop 接入 AI Agent，涵盖 ' + ruleCount + ' 条 SEO 检测规则的接入与使用说明。',
  inLanguage: 'zh-CN',
  url: '/skills',
}).replace(/</g, '\\u003c')}</script>
<style>
:root{color-scheme:light dark;--fg:#0d1117;--bg:#fff;--muted:#5b6472;--line:#e6e9ee;
 --surface:#f7f8fa;--accent:#1a5fd0;--ok:#067647;--warn:#b54708;--max:900px}
@media(prefers-color-scheme:dark){:root{--fg:#e8ebf0;--bg:#0c0f14;--muted:#9aa4b2;
 --line:#232833;--surface:#131720;--accent:#5b9bf8}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
 font:16px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
a{color:var(--accent)}
.wrap{max-width:var(--max);margin:0 auto;padding:0 24px}
header{border-bottom:1px solid var(--line)}
header .wrap{display:flex;align-items:center;gap:22px;height:60px}
.logo{display:flex;align-items:center;gap:9px;font-weight:700;color:var(--fg);
 text-decoration:none;font-size:17px}
header nav{margin-left:auto;display:flex;gap:22px}
header nav a{color:var(--muted);text-decoration:none;font-size:14.5px}
header nav a:hover{color:var(--fg)}
h1{font-size:2rem;margin:44px 0 12px;letter-spacing:-.02em}
.lead{color:var(--muted);margin:0 0 34px;font-size:16.5px}
h2{font-size:1.28rem;margin:44px 0 8px;letter-spacing:-.01em}
.intro{color:var(--muted);font-size:14.8px;margin:0 0 16px}
pre{background:var(--surface);border:1px solid var(--line);border-radius:10px;
 padding:15px 17px;overflow-x:auto;font-size:13px;line-height:1.65;margin:0 0 16px;
 font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
table{width:100%;border-collapse:collapse;font-size:14px;display:block;overflow-x:auto}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
td:nth-child(2){color:var(--muted);min-width:280px}
td:nth-child(3),td:nth-child(4),th:nth-child(3),th:nth-child(4){white-space:nowrap}
th{font-size:12.5px;color:var(--muted);font-weight:500}
.note{border-left:3px solid var(--accent);padding:2px 0 2px 15px;margin:22px 0;
 color:var(--muted);font-size:14.5px}
.warn{border-left-color:var(--warn)}
.step{background:var(--surface);border:1px solid var(--line);border-radius:12px;
 padding:20px 22px;margin-bottom:14px}
.step h3{margin:0 0 8px;font-size:15.5px}
.step p{margin:0 0 10px;color:var(--muted);font-size:14.5px}
.step pre{background:var(--bg)}
footer{border-top:1px solid var(--line);margin-top:60px;padding:26px 0;
 color:var(--muted);font-size:13.5px}
</style></head><body>
<header><div class="wrap">
<a class="logo" href="/">RankLoop</a>
<nav><a href="/docs">接入文档</a><a href="/skills">AI Agent</a><a href="/console">控制台</a></nav>
</div></header>

<main class="wrap">
<h1>接入 AI Agent</h1>
<p class="lead">RankLoop 检测出问题并给出结构化建议，AI 负责修复并重新提交。
平台本身不含 AI——判断由规则引擎给出，可复现、可解释。</p>

<h2>为什么能自动闭环</h2>
<p class="intro">Webhook 推送的是机器可读的结构化数据，不是给人看的文字。
接收端是人还是 AI，平台都不用改。</p>
<pre>{
  "event": "content.gate_failed",
  "data": {
    "blocking": ["MISSING_TITLE", "EMPTY_CONTENT"],
    "score": 1
  },
  "links": {
    "recommendations": "/api/v1/contents/{id}/recommendations"
  }
}</pre>
<p class="intro">拉取 <code>recommendations</code> 得到每条问题的规则码、证据、修复建议，
以及<strong>修好能加几分</strong>和<strong>大概要花几分钟</strong>——
按性价比排好序，AI 从头做即可。</p>
<pre>{
  "code": "MISSING_TITLE",
  "message": "页面缺少 title",
  "evidence": "title 为空或未提供",
  "recommendation": "添加 10-60 字符的标题，包含核心关键词。",
  "gain": 30, "minutes": 8, "blocking": true
}</pre>

<h2>三步接入</h2>
<div class="step"><h3>1. 登记回调地址</h3>
<p>平台在内容被拦、发布成功时通知你。地址必须是 https，且不能指向内网。</p>
<pre>curl -X POST https://rankloop.miaokit.cloud/api/v1/webhooks \\
  -H "Authorization: Bearer $RANKLOOP_KEY" \\
  -H "content-type: application/json" \\
  -d '{"url":"https://your-app.com/hooks/rankloop"}'</pre>
<p>响应里的 <code>secret</code> 只显示一次，用它校验 <code>X-RankLoop-Signature</code>。</p></div>

<div class="step"><h3>2. 收到通知后拉取建议</h3>
<p>轻量 payload 只带 ID 与链接，凭密钥回调拉取详情——重试时拿到的始终是最新状态。</p>
<pre>GET /api/v1/contents/{contentId}/recommendations</pre></div>

<div class="step"><h3>3. 让 AI 按建议修复并重新提交</h3>
<p>修完调用更新接口产生新版本，再次发布。未通过门槛会再次被拦，直到修好为止。</p>
<pre>PUT  /api/v1/contents/{contentId}
POST /api/v1/contents/{contentId}/publish</pre></div>

<h2>用 Python SDK 更省事</h2>
<p class="intro">零依赖，把「被门槛拦截」做成可直接读取的异常。</p>
<pre>pip install rankloop</pre>
<pre>from rankloop import Client

client = Client(api_key="rkl_live_xxx")
ok, todo = client.publish_when_ready(content_id)

if not ok:
    for r in todo:
        print(r.message, r.recommendation, f"约 {r.minutes} 分钟")</pre>

<h2>社区 SEO Skills</h2>
<p class="intro">以下是社区维护的 SEO 技能包，可与 RankLoop 配合使用：
它们提供 SEO 知识与写作指导，RankLoop 提供可验证的检测与发布门槛。</p>
${repoTable(SKILLS)}

<div class="note warn"><strong>选用前请注意：</strong>上述仓库均为 2026 年新建，
star 数很高，但那只说明热度，<strong>不代表其中 SEO 建议的正确性</strong>。
这些内容多为社区撰写、未经系统验证。建议先抽查具体条目是否符合 Google 当前行为，
再决定是否依赖。RankLoop 的 ${ruleCount} 条规则每一条都能在真实内容上跑出可复现结论，
两者用途不同。</div>

<h2>SEO 相关 MCP Server</h2>
<p class="intro">让 AI 直接读取搜索数据。注意 Google 官方<strong>没有</strong>
Search Console MCP，现有的都是第三方项目。</p>
${repoTable(MCPS)}

<div class="note">Anthropic 官方 skills 仓库目前<strong>不含任何 SEO 内容</strong>，
Google 也未发布机器可读的 SEO 规则集。除 Lighthouse 的 9 条基础技术审计外，
业界缺少权威的机器可读规则集——这正是 RankLoop 规则引擎的定位。</div>

<h2>关于效果的说明</h2>
<p class="intro">平台负责消除技术层面的障碍：拦截会导致不被收录的问题、
生成合规 sitemap 并提交 Search Console、发布后持续回读真实搜索表现。</p>
<div class="note warn"><strong>没有任何工具能保证排名或流量。</strong>
那取决于内容质量、站点权威度与竞争程度，由 Google 决定。
Google 官方明确说明抓取需要数天至数周，且不保证收录。
任何声称能保证排名的 SEO 工具都不可信。</div>
</main>

<footer><div class="wrap">RankLoop · SEO 全生命周期管理 ·
<a href="/docs">接入文档</a> · <a href="/console">控制台</a></div></footer>
</body></html>`
}

export async function skillsRoutes(app: FastifyInstance, ruleCount: number): Promise<void> {
  const html = renderSkills(ruleCount)
  app.get('/skills', async (_req, reply) => reply.type('text/html; charset=utf-8').send(html))
}
