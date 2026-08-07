import type { FastifyInstance } from 'fastify'

/**
 * 可视化面板。
 *
 * 直接由 API 进程提供静态页面，而非独立的 Next.js 应用：
 * 单容器、单域名、无需额外构建，符合「一键部署」的目标。
 * 数据全部来自 /api/v1 真实接口，页面内不含任何演示数据（规格 §0 第 7 条）。
 */

const PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>RankLoop SEO 控制台</title>
<style>
:root{
  --bg:#0f1115; --panel:#171a21; --panel-2:#1e222b; --line:#272c37;
  --fg:#e6e9ef; --muted:#9aa4b2; --accent:#4f8ef7;
  --critical:#f2555a; --warning:#f5a524; --notice:#3aa6ff; --ok:#2fbf71;
}
@media (prefers-color-scheme:light){
  :root{--bg:#f6f7f9;--panel:#fff;--panel-2:#f0f2f5;--line:#e2e5ea;--fg:#171a21;--muted:#5b6472;}
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
  font:14px/1.6 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
header{padding:20px 28px;border-bottom:1px solid var(--line);display:flex;
  align-items:center;gap:16px;flex-wrap:wrap;background:var(--panel)}
h1{font-size:17px;margin:0;font-weight:650;letter-spacing:.2px}
.badge{font-size:12px;color:var(--muted);border:1px solid var(--line);
  padding:2px 8px;border-radius:999px}
main{padding:24px 28px;max-width:1280px;margin:0 auto}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin-bottom:20px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px}
.card h3{margin:0 0 10px;font-size:12px;color:var(--muted);font-weight:500;
  text-transform:uppercase;letter-spacing:.6px}
.metric{font-size:30px;font-weight:680;line-height:1.15;font-variant-numeric:tabular-nums}
.sub{font-size:12px;color:var(--muted);margin-top:6px}
.row{display:grid;gap:16px;grid-template-columns:1.4fr 1fr;margin-bottom:20px}
@media(max-width:900px){.row{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:500;font-size:12px}
td.num{text-align:right;font-variant-numeric:tabular-nums}
.tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:2px 8px;
  border-radius:999px;border:1px solid transparent;white-space:nowrap}
.tag::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.critical{color:var(--critical);background:color-mix(in srgb,var(--critical) 12%,transparent)}
.warning{color:var(--warning);background:color-mix(in srgb,var(--warning) 12%,transparent)}
.notice{color:var(--notice);background:color-mix(in srgb,var(--notice) 12%,transparent)}
.ok{color:var(--ok)}
.bar{height:7px;border-radius:4px;background:var(--panel-2);overflow:hidden;margin-top:9px}
.bar>i{display:block;height:100%;border-radius:4px;background:var(--accent)}
svg{width:100%;height:170px;display:block}
input{background:var(--panel-2);border:1px solid var(--line);color:var(--fg);
  padding:7px 11px;border-radius:8px;font:inherit;font-size:13px;min-width:290px}
button{background:var(--accent);color:#fff;border:0;padding:7px 15px;border-radius:8px;
  font:inherit;font-size:13px;cursor:pointer;font-weight:520}
button:hover{filter:brightness(1.08)}
.empty{color:var(--muted);padding:26px 10px;text-align:center;font-size:13px}
.err{background:color-mix(in srgb,var(--critical) 10%,transparent);
  border:1px solid var(--critical);color:var(--critical);
  padding:11px 14px;border-radius:9px;margin-bottom:16px;font-size:13px}
code{background:var(--panel-2);padding:1px 6px;border-radius:5px;font-size:12px}
.muted{color:var(--muted)}
</style>
</head>
<body>
<header>
  <h1>RankLoop SEO</h1>
  <span class="badge" id="rulesBadge">规则加载中…</span>
  <span style="flex:1"></span>
  <input id="key" type="password" placeholder="API Key (rkl_live_…)" autocomplete="off">
  <button id="load">加载</button>
</header>
<main>
  <div id="err"></div>
  <div id="content" hidden>
    <div class="grid">
      <div class="card"><h3>平均健康分</h3>
        <div class="metric" id="score">—</div>
        <div class="bar"><i id="scoreBar" style="width:0%"></i></div>
        <div class="sub" id="scoreSub"></div></div>
      <div class="card"><h3>内容总数</h3>
        <div class="metric" id="total">—</div>
        <div class="sub" id="totalSub"></div></div>
      <div class="card"><h3>可发布</h3>
        <div class="metric ok" id="publishable">—</div>
        <div class="sub">无 critical 问题</div></div>
      <div class="card"><h3>被门槛拦截</h3>
        <div class="metric" id="blocked" style="color:var(--critical)">—</div>
        <div class="sub">存在 critical 问题</div></div>
    </div>
    <div class="row">
      <div class="card"><h3>健康分趋势（30 天）</h3><div id="trend"></div></div>
      <div class="card"><h3>问题分布</h3><div id="severity"></div></div>
    </div>
    <div class="card"><h3>最常见问题</h3><div id="issues"></div></div>
  </div>
</main>
<script>
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))

async function api(path, key) {
  const r = await fetch('/api/v1' + path, { headers: { Authorization: 'Bearer ' + key } })
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    throw new Error(body?.error?.message || ('请求失败 HTTP ' + r.status))
  }
  return (await r.json()).data
}

function sparkline(points) {
  if (!points.length) return '<div class="empty">暂无检测记录</div>'
  if (points.length === 1) {
    return '<div class="empty">仅 1 天数据，趋势需至少 2 天<br><span class="muted">当前均分 '
      + points[0].average_score + '</span></div>'
  }
  const w = 560, h = 170, pad = 26
  const xs = (i) => pad + (i * (w - pad * 2)) / (points.length - 1)
  const ys = (v) => h - pad - (v / 100) * (h - pad * 2)
  const line = points.map((p, i) => (i ? 'L' : 'M') + xs(i).toFixed(1) + ' ' + ys(p.average_score).toFixed(1)).join(' ')
  const area = line + ' L' + xs(points.length - 1).toFixed(1) + ' ' + (h - pad) + ' L' + pad + ' ' + (h - pad) + ' Z'
  const dots = points.map((p, i) =>
    '<circle cx="' + xs(i).toFixed(1) + '" cy="' + ys(p.average_score).toFixed(1) +
    '" r="2.5" fill="var(--accent)"><title>' + esc(p.date) + '：' + p.average_score + ' 分（' +
    p.checks + ' 次检测）</title></circle>').join('')
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="健康分趋势折线图">' +
    [0, 50, 100].map((v) =>
      '<line x1="' + pad + '" y1="' + ys(v) + '" x2="' + (w - pad) + '" y2="' + ys(v) +
      '" stroke="var(--line)"/><text x="4" y="' + (ys(v) + 4) +
      '" fill="var(--muted)" font-size="10">' + v + '</text>').join('') +
    '<path d="' + area + '" fill="var(--accent)" opacity=".1"/>' +
    '<path d="' + line + '" fill="none" stroke="var(--accent)" stroke-width="2"/>' + dots + '</svg>'
}

function severityBars(h) {
  const rows = [
    ['严重', h.critical, 'critical'],
    ['警告', h.warning, 'warning'],
    ['建议', h.notice, 'notice'],
  ]
  const max = Math.max(1, ...rows.map((r) => r[1]))
  if (rows.every((r) => !r[1])) return '<div class="empty">未发现问题</div>'
  return '<table>' + rows.map(([label, n, cls]) =>
    '<tr><td style="width:74px"><span class="tag ' + cls + '">' + label + '</span></td>' +
    '<td><div class="bar"><i style="width:' + ((n / max) * 100) + '%;background:var(--' + cls + ')"></i></div></td>' +
    '<td class="num" style="width:56px">' + n + '</td></tr>').join('') + '</table>'
}

function issueTable(list) {
  if (!list.length) return '<div class="empty">未发现问题 🎉</div>'
  return '<table><thead><tr><th>规则</th><th>级别</th><th class="num">影响页面</th>' +
    '<th class="num">可挽回</th></tr></thead><tbody>' +
    list.map((i) => '<tr><td><code>' + esc(i.code) + '</code></td>' +
      '<td><span class="tag ' + esc(i.severity) + '">' + esc(i.severity) + '</span></td>' +
      '<td class="num">' + i.count + '</td>' +
      '<td class="num">+' + i.recoverable + '</td></tr>').join('') + '</tbody></table>'
}

async function load() {
  const key = $('key').value.trim()
  $('err').innerHTML = ''
  if (!key) { $('err').innerHTML = '<div class="err">请输入 API Key</div>'; return }

  try {
    const [s, trend] = await Promise.all([api('/stats/overview', key), api('/stats/trend', key)])
    $('content').hidden = false
    sessionStorage.setItem('rankloop_key', key)

    const score = s.health.average_score
    $('score').textContent = score === null ? '暂无数据' : score
    $('score').style.color = score === null ? 'var(--muted)'
      : score >= 80 ? 'var(--ok)' : score >= 60 ? 'var(--warning)' : 'var(--critical)'
    $('scoreBar').style.width = (score ?? 0) + '%'
    $('scoreSub').textContent = score === null ? '尚未提交任何内容' : '满分 100'

    $('total').textContent = s.contents.total
    $('totalSub').textContent = '已发布 ' + s.contents.published + ' · 草稿 ' + s.contents.draft +
      ' · 站点 ' + s.sites
    $('publishable').textContent = s.publishable
    $('blocked').textContent = s.blocked
    $('trend').innerHTML = sparkline(trend)
    $('severity').innerHTML = severityBars(s.health)
    $('issues').innerHTML = issueTable(s.top_issues)
  } catch (e) {
    $('content').hidden = true
    $('err').innerHTML = '<div class="err">' + esc(e.message) + '</div>'
  }
}

$('load').addEventListener('click', load)
$('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') load() })

fetch('/api/v1/rules').then((r) => r.json()).then((d) => {
  $('rulesBadge').textContent = d.data.length + ' 条检测规则'
}).catch(() => { $('rulesBadge').textContent = '规则加载失败' })

const saved = sessionStorage.getItem('rankloop_key')
if (saved) { $('key').value = saved; load() }
</script>
</body>
</html>`

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/overview', async (_req, reply) => {
    return reply.type('text/html; charset=utf-8').send(PAGE)
  })

  // 内联 SVG favicon，避免浏览器每次请求产生 404 噪声
  app.get('/favicon.svg', async (_req, reply) => {
    return reply
      .type('image/svg+xml')
      .header('cache-control', 'public, max-age=86400')
      .send(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
          '<rect width="32" height="32" rx="7" fill="#4f8ef7"/>' +
          '<path d="M9 21V11h6a3 3 0 0 1 0 6h-3l5 4" stroke="#fff" stroke-width="2.4" ' +
          'fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      )
  })

  app.get('/favicon.ico', async (_req, reply) => reply.redirect('/favicon.svg', 301))
}
