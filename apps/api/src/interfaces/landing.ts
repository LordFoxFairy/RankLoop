import type { FastifyInstance } from 'fastify'

/**
 * 平台对外首页。
 *
 * 面向访客的产品落地页，不是文档 —— 首屏讲清楚「解决什么问题」，
 * 而不是罗列功能。规则数量等指标从真实接口读取，不写死。
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface LandingData {
  ruleCount: number
  criticalCount: number
  /** 站点绝对地址：og:image 必须是绝对 URL，相对路径社交平台抓不到 */
  siteUrl: string
}

const FEATURES = [
  {
    icon: '🛡',
    title: '发布前拦截',
    body: '存在严重问题的内容无法发布。标题缺失、noindex、canonical 跨域这些会直接导致不被收录的问题，在上线前就被挡住。',
  },
  {
    icon: '🔁',
    title: '可迭代修复',
    body: '每次提交都返回具体的规则编码、触发证据与修复建议。内容方据此修改后重新提交，反复迭代直到全部通过。',
  },
  {
    icon: '🏢',
    title: '多租户隔离',
    body: '每个客户独立域名、独立内容、独立 sitemap，彼此完全不可见。凭据直接绑定归属，无法越权访问他人内容。',
  },
  {
    icon: '📐',
    title: '可解释评分',
    body: '健康分由各规则权重累计扣除，每一分都能追溯到具体规则与证据。没有说不清来源的黑盒分数。',
  },
  {
    icon: '🔎',
    title: '搜索引擎提交',
    body: '内容发布后自动生成 sitemap 并提交 Google Search Console，同时通过 IndexNow 通知 Bing 与 Yandex。',
  },
  {
    icon: '🌐',
    title: '自有域名',
    body: '绑定客户自己的域名，内容权重积累在客户域名下而非平台。这是子域名方案做不到的。',
  },
] as const

const STEPS = [
  { n: '01', t: '提交', d: '内容以 HTML 或 Markdown 推送到平台' },
  { n: '02', t: '检测', d: '规则引擎返回问题清单与修复建议' },
  { n: '03', t: '迭代', d: '第三方自行优化后重新提交，可多轮' },
  { n: '04', t: '发布', d: '达标才放行，随即渲染上线' },
  { n: '05', t: '提交收录', d: 'sitemap 自动更新并推送搜索引擎' },
] as const

const FAQS = [
  {
    q: '能保证 Google 收录吗？',
    a: '不能，任何工具都不能。Google 官方明确说明抓取需要数天至数周，且不保证收录。本平台的作用是确保技术层面不拖后腿：拦截会导致不被收录的问题、生成合规 sitemap 并主动提交，让 Google 更快发现。',
  },
  {
    q: '为什么不用 Indexing API 立即收录？',
    a: 'Google 的 Indexing API 官方限定只能用于 JobPosting 与 BroadcastEvent 两种结构化类型，普通文章不在其列。声称能用它「秒收录」文章的做法属于滥用协议。',
  },
  {
    q: '平台会生成内容吗？',
    a: '不会。平台不介入 AI，不生成文章与文案，只提供检测接口与判定结果。内容优化由第三方自行完成——他们可以用自己的 AI，平台只负责把不合格的地方讲清楚。',
  },
  {
    q: '内容存在哪里？',
    a: '存在平台数据库中，按租户隔离。每次更新产生新版本，可回溯历史与分数变化。发布后由平台按域名渲染，也可绑定客户自有域名。',
  },
] as const

export function renderLanding(data: LandingData): string {
  const featureCards = FEATURES.map(
    (f, i) => `<article class="card">
  <img class="ico-img" src="/img/feature-${i + 1}.png" width="800" height="500"
    loading="lazy" alt="${escapeHtml(f.title)}功能示意图">
  <h3>${escapeHtml(f.title)}</h3>
  <p>${escapeHtml(f.body)}</p>
</article>`,
  ).join('')

  const steps = STEPS.map(
    (s) => `<li><span class="num">${s.n}</span><div><strong>${escapeHtml(s.t)}</strong><p>${escapeHtml(s.d)}</p></div></li>`,
  ).join('')

  const faqs = FAQS.map(
    (f) => `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`,
  ).join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>RankLoop — 把内容质量变成搜索增长</title>
<meta name="description" content="检测、优化、发布、收录闭环管理。${data.ruleCount} 条规则在发布前拦截 SEO 缺陷，达标内容自动进入 sitemap 并提交搜索引擎，发布后回读搜索表现数据。">
<link rel="canonical" href="${escapeHtml(data.siteUrl)}/">
<meta property="og:type" content="website">
<meta property="og:title" content="RankLoop — 把内容质量变成搜索增长">
<meta property="og:description" content="检测、优化、发布、收录——每一步都沉淀为下一次增长。">
<meta property="og:image" content="${escapeHtml(data.siteUrl)}/img/og-cover.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${escapeHtml(data.siteUrl)}/img/og-cover.png">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'RankLoop',
  applicationCategory: 'BusinessApplication',
  description: `内容发布前自动执行 ${data.ruleCount} 条 SEO 规则检测，存在严重问题的内容无法发布。`,
  url: `${data.siteUrl}/`,
  operatingSystem: 'Web',
}).replace(/</g, '\\u003c')}</script>
<style>
:root{
  color-scheme:light;
  --fg:#0d1117;--bg:#fff;--muted:#5b6472;--line:#e6e9ee;--surface:#f7f8fa;
  --accent:#1a5fd0;--accent-fg:#fff;--ok:#067647;--warn:#b54708;--crit:#b42318;
  --max:1120px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);
 font:16px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
 -webkit-font-smoothing:antialiased}
a{color:var(--accent)}
.wrap{max-width:var(--max);margin:0 auto;padding:0 24px}

header{position:sticky;top:0;z-index:10;backdrop-filter:blur(12px);
 background:color-mix(in srgb,var(--bg) 82%,transparent);border-bottom:1px solid var(--line)}
header .wrap{display:flex;align-items:center;gap:28px;height:62px}
.logo{display:flex;align-items:center;gap:9px;font-weight:700;font-size:17px;
 color:var(--fg);text-decoration:none;letter-spacing:-.01em}
.logo svg{width:26px;height:26px;flex:none}
header nav{display:flex;gap:24px;margin-left:auto}
header nav a{color:var(--muted);text-decoration:none;font-size:14.5px}
header nav a:hover{color:var(--fg)}
.btn{display:inline-flex;align-items:center;justify-content:center;
 padding:10px 20px;border-radius:9px;text-decoration:none;font-size:14.5px;
 font-weight:560;border:1px solid var(--line);color:var(--fg);white-space:nowrap;
 transition:.15s}
.btn.primary{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
.btn.primary:hover{filter:brightness(1.08)}
.btn:hover{border-color:var(--muted)}

.hero{padding:88px 0 72px;text-align:center}
.badge{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--muted);
 border:1px solid var(--line);border-radius:999px;padding:5px 14px;margin-bottom:26px}
.badge b{color:var(--fg);font-weight:600}
.hero h1{font-size:clamp(2.1rem,5.2vw,3.5rem);line-height:1.12;margin:0 0 20px;
 letter-spacing:-.025em;font-weight:750}
.hero .sub{font-size:clamp(1rem,2vw,1.19rem);color:var(--muted);max-width:640px;
 margin:0 auto 34px;line-height:1.65}
.cta{display:flex;gap:13px;justify-content:center;flex-wrap:wrap}

.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));
 gap:1px;background:var(--line);border:1px solid var(--line);border-radius:14px;
 overflow:hidden;margin:72px 0}
.stat{background:var(--bg);padding:26px 20px;text-align:center}
.stat b{display:block;font-size:2.1rem;font-weight:720;letter-spacing:-.02em;line-height:1.1}
.stat span{display:block;font-size:13.5px;color:var(--muted);margin-top:7px}

section{padding:72px 0}
.sec-head{text-align:center;max-width:620px;margin:0 auto 46px}
.sec-head h2{font-size:clamp(1.55rem,3.4vw,2.15rem);margin:0 0 13px;
 letter-spacing:-.02em;font-weight:700}
.sec-head p{color:var(--muted);margin:0;font-size:16.5px}

.grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(310px,1fr))}
.card{border:1px solid var(--line);border-radius:14px;padding:26px;background:var(--bg);
 transition:.18s}
.card:hover{border-color:color-mix(in srgb,var(--accent) 40%,var(--line));
 transform:translateY(-2px)}
.card .ico{font-size:22px;margin-bottom:13px;line-height:1}
.card .ico-img{width:100%;height:auto;border-radius:9px;margin-bottom:14px;
 display:block;background:var(--surface)}
.shot{margin:52px 0 0;padding:0}
.shot img{width:100%;height:auto;border-radius:14px;display:block;
 border:1px solid var(--line);box-shadow:0 18px 48px -22px rgba(0,0,0,.42)}
.flow-img img{border:0;box-shadow:none;background:transparent}
.hl{color:var(--accent)}
.card h3{margin:0 0 9px;font-size:16.5px;font-weight:640}
.card p{margin:0;color:var(--muted);font-size:14.8px;line-height:1.65}

.flow{background:var(--surface);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.steps{list-style:none;padding:0;margin:0;display:grid;gap:15px;
 grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.steps li{display:flex;gap:14px;align-items:flex-start}
.steps .num{font-size:12.5px;font-weight:700;color:var(--accent);
 border:1.5px solid currentColor;border-radius:7px;padding:3px 8px;flex:none;margin-top:2px}
.steps strong{display:block;font-size:15.5px;margin-bottom:3px}
.steps p{margin:0;color:var(--muted);font-size:14px;line-height:1.6}

.demo{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--bg)}
.demo-bar{background:var(--surface);border-bottom:1px solid var(--line);
 padding:10px 16px;display:flex;gap:7px;align-items:center}
.dot{width:11px;height:11px;border-radius:50%;background:var(--line)}
.demo-bar span{margin-left:9px;font-size:12.5px;color:var(--muted);
 font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.demo pre{margin:0;padding:20px;overflow-x:auto;font-size:13px;line-height:1.7;
 font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.result{padding:26px}
.res-row{display:flex;gap:22px;align-items:flex-start}
.res-score{font-size:2.6rem;font-weight:750;line-height:1;flex:none;
 width:88px;text-align:center;padding:14px 0;border-radius:12px}
.res-score small{display:block;font-size:.85rem;font-weight:500;opacity:.75;margin-top:4px}
.res-score.bad{color:var(--crit);background:color-mix(in srgb,var(--crit) 10%,transparent)}
.res-score.good{color:var(--ok);background:color-mix(in srgb,var(--ok) 10%,transparent)}
.res-body strong{display:block;font-size:16px;margin-bottom:8px}
.res-body ul{margin:0;padding-left:19px;color:var(--muted);font-size:14.5px;line-height:1.75}
.res-body b{color:var(--fg);font-weight:600}
.res-arrow{margin:20px 0;padding-left:110px;color:var(--muted);font-size:13.5px;
 position:relative}
.res-arrow::before{content:"↓";position:absolute;left:40px;font-size:20px;color:var(--accent)}
.demo .c{color:var(--muted)}
.demo .k{color:var(--crit);font-weight:600}
.demo .g{color:var(--ok);font-weight:600}
.demo .w{color:var(--warn)}

details{border:1px solid var(--line);border-radius:11px;padding:16px 20px;margin-bottom:11px;
 background:var(--bg)}
details summary{cursor:pointer;font-weight:580;font-size:15.5px;list-style:none}
details summary::-webkit-details-marker{display:none}
details summary::after{content:"+";float:right;color:var(--muted);font-weight:400}
details[open] summary::after{content:"−"}
details p{margin:13px 0 0;color:var(--muted);font-size:14.8px;line-height:1.7}

.final{text-align:center;padding:82px 0}
.final h2{font-size:clamp(1.6rem,3.6vw,2.3rem);margin:0 0 15px;letter-spacing:-.02em}
.final p{color:var(--muted);margin:0 auto 30px;max-width:520px}

footer{border-top:1px solid var(--line);padding:34px 0;color:var(--muted);font-size:14px}
footer .wrap{display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap;align-items:center}
footer a{color:var(--muted);text-decoration:none;margin-left:20px}
footer a:hover{color:var(--fg)}
@media(max-width:640px){
  header nav{display:none}
  .hero{padding:58px 0 48px}
  section{padding:52px 0}
}
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
  <nav>
    <a href="#features">功能</a>
    <a href="#flow">工作方式</a>
    <a href="#faq">常见问题</a>
    <a href="/docs">开发者</a>
    <a href="/skills">AI Agent</a>
  </nav>
  <a class="btn primary" href="/console">进入控制台</a>
</div></header>

<div class="wrap">
  <div class="hero">
    <div class="badge"><b>${data.ruleCount}</b> 条检测规则 · <b>${data.criticalCount}</b> 条可阻断发布</div>
    <h1>把内容质量，<br>变成<span class="hl">搜索增长</span>。</h1>
    <p class="sub">
      检测、优化、发布、收录——每一步都沉淀为下一次增长。
      不达标的内容进不了线上，达标的自动进入 sitemap 并推送搜索引擎。
    </p>
    <div class="cta">
      <a class="btn primary" href="/console">开始使用</a>
      <a class="btn" href="#flow">了解工作方式</a>
    </div>
  </div>

  <figure class="shot">
    <img src="/img/hero-product.png" width="1600" height="1000" loading="eager"
      alt="RankLoop 增长工作台界面：内容健康度评分、优化建议列表与发布后的搜索可见度趋势">
  </figure>

  <div class="stats">
    <div class="stat"><b>${data.ruleCount}</b><span>检测规则</span></div>
    <div class="stat"><b>0</b><span>人工介入</span></div>
    <div class="stat"><b>2</b><span>支持格式</span></div>
    <div class="stat"><b>100%</b><span>可解释评分</span></div>
  </div>
</div>

<section id="features"><div class="wrap">
  <div class="sec-head">
    <h2>每一次发布，都往前走一步</h2>
    <p>问题在上线前就被拦住，达标的内容自动进入收录流程。</p>
  </div>
  <div class="grid">${featureCards}</div>
</div></section>

<section><div class="wrap">
  <div class="sec-head">
    <h2>发布之后，看得见效果</h2>
    <p>回读 Search Console 数据：哪些词带来点击、排名多少、趋势如何。</p>
  </div>
  <figure class="shot">
    <img src="/img/dashboard-preview.png" width="1600" height="1000" loading="lazy"
      alt="搜索表现面板：点击与曝光趋势、关键词排行、平均排名变化">
  </figure>
</div></section>

<section id="flow" class="flow"><div class="wrap">
  <div class="sec-head">
    <h2>五步闭环</h2>
    <p>第三方自行优化，平台只负责判定——不生成内容，不介入 AI。</p>
  </div>
  <ol class="steps">${steps}</ol>

  <figure class="shot flow-img">
    <img src="/img/flow-diagram.png" width="1400" height="500" loading="lazy"
      alt="五步闭环示意图：提交内容、规则检测、迭代修复、达标发布、提交搜索引擎收录">
  </figure>

  <div style="margin-top:46px" class="demo">
    <div class="demo-bar">
      <i class="dot"></i><i class="dot"></i><i class="dot"></i>
      <span>检测结果</span>
    </div>
    <div class="result">
      <div class="res-row">
        <div class="res-score bad">0<small>分</small></div>
        <div class="res-body">
          <strong>这篇内容发不出去</strong>
          <ul>
            <li><b>缺少标题</b>——搜索结果会由引擎自行生成，失去关键词控制权</li>
            <li><b>正文过少</b>——疑似空页面，不会被收录</li>
          </ul>
        </div>
      </div>
      <div class="res-arrow">内容方按提示修改后重新提交</div>
      <div class="res-row">
        <div class="res-score good">100<small>分</small></div>
        <div class="res-body">
          <strong>已通过，可以发布</strong>
          <ul><li>发布后自动进入 sitemap 并推送搜索引擎</li></ul>
        </div>
      </div>
    </div>
  </div>
</div></section>

<section id="faq"><div class="wrap" style="max-width:760px">
  <div class="sec-head">
    <h2>常见问题</h2>
    <p>关于能做什么、不能做什么，如实说明。</p>
  </div>
  ${faqs}
</div></section>

<div class="wrap"><div class="final">
  <h2>从第一篇内容开始</h2>
  <p>推一篇进来，看看它的健康分与优化空间。</p>
  <div class="cta">
    <a class="btn primary" href="/console">进入控制台</a>
    <a class="btn" href="#features">了解功能</a>
  </div>
</div></div>

<footer><div class="wrap">
  <span>RankLoop · 把内容质量变成搜索增长</span>
  <span>
    <a href="/console">控制台</a>
    <a href="/docs">开发者文档</a>
    <a href="/skills">AI Agent 接入</a>
    <a href="/api/v1/rules">规则清单</a>
  </span>
</div></footer>

</body>
</html>
`
}

export async function landingRoutes(
  app: FastifyInstance,
  data: LandingData,
): Promise<void> {
  const html = renderLanding(data)
  app.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8').send(html))
}
