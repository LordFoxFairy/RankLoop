/**
 * 控制台外壳：侧栏导航 + 内容区。
 *
 * 布局取代原先的水平标签页——导航项会随功能增长，水平排布很快挤不下，
 * 且无法分组。侧栏可分区（工作 / 数据 / 管理），层级更清楚。
 *
 * 视觉基调：冷灰底 + 墨蓝侧栏，数字一律等宽字体——
 * 分数、耗时、增益都是需要横向对比的量，等宽才能纵向对齐扫读。
 */

export const CONSOLE_STYLES = String.raw`
:root{
  --ink:#12161f;
  --ink-soft:#1b2130;
  --paper:#f4f6f9;
  --surface:#fff;
  --line:#e3e7ee;
  --text:#1a1f2b;
  --muted:#6b7688;
  --faint:#98a2b3;
  --accent:#2f5fd8;
  --accent-soft:#eaf0fe;
  --blocked:#c8322b;
  --blocked-soft:#fdeceb;
  --warn:#b4690e;
  --warn-soft:#fdf3e6;
  --gain:#1f7a4d;
  --gain-soft:#e8f5ee;
  --radius:12px;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;
  --sans:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
}
@media(prefers-color-scheme:dark){
  :root{
    --paper:#0d1117;--surface:#161b26;--line:#242b39;--text:#e6e9f0;
    --muted:#98a2b3;--faint:#6b7688;--accent:#5b8def;--accent-soft:#1a2540;
    --blocked-soft:#3a1d1b;--warn-soft:#3a2c14;--gain-soft:#14301f;
  }
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--paper);color:var(--text);font:14px/1.6 var(--sans);
  -webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit;color:inherit}

/* ── 布局骨架 ── */
.app{display:grid;grid-template-columns:232px 1fr;min-height:100vh}
.side{background:var(--ink);color:#e8ebf2;display:flex;flex-direction:column;
  position:sticky;top:0;height:100vh;overflow-y:auto}
.brand{display:flex;align-items:center;gap:10px;padding:20px 18px 22px;
  font-weight:680;font-size:16px;letter-spacing:-.01em}
.brand svg{width:26px;height:26px;flex:none}
.nav-group{padding:0 10px 4px}
.nav-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;
  color:#6b7688;padding:14px 10px 6px;font-weight:600}
.nav-item{display:flex;align-items:center;gap:10px;width:100%;
  padding:9px 11px;border:0;background:transparent;color:#b9c1d1;
  border-radius:9px;cursor:pointer;font-size:14px;text-align:left;
  transition:background .12s,color .12s}
.nav-item:hover{background:#1e2534;color:#fff}
.nav-item[aria-current="page"]{background:var(--accent);color:#fff;font-weight:560}
.nav-item .ic{width:17px;height:17px;flex:none;opacity:.9}
.nav-item .badge{margin-left:auto;font:600 11px/1 var(--mono);
  background:var(--blocked);color:#fff;padding:3px 6px;border-radius:20px}
.side-foot{margin-top:auto;padding:14px 18px;border-top:1px solid #232a39;
  font-size:12px;color:#8892a4}
.side-foot button{background:none;border:0;color:#8892a4;cursor:pointer;
  padding:0;font-size:12px;text-decoration:underline;text-underline-offset:3px}
.side-foot button:hover{color:#fff}

.main{min-width:0;display:flex;flex-direction:column}
.topbar{display:flex;align-items:center;gap:14px;padding:18px 26px 0;flex-wrap:wrap}
.topbar h1{font-size:21px;margin:0;letter-spacing:-.015em;font-weight:670}
.topbar .sub{color:var(--muted);font-size:13px}
.content{padding:18px 26px 40px;flex:1}

/* ── 通用块 ── */
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius)}
.panel-head{padding:14px 18px;border-bottom:1px solid var(--line);
  display:flex;align-items:center;gap:12px}
.panel-head h2{margin:0;font-size:14px;font-weight:620}
.panel-body{padding:18px}
.toolbar{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:16px;
  background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  padding:11px 13px}
.toolbar input,.toolbar select{background:var(--paper);border:1px solid var(--line);
  border-radius:8px;padding:7px 11px;font-size:13px;min-width:150px}
.toolbar input:focus,.toolbar select:focus{outline:2px solid var(--accent);outline-offset:-1px}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;
  padding:7px 14px;border-radius:8px;border:1px solid var(--line);
  background:var(--surface);cursor:pointer;font-size:13px;font-weight:520;
  transition:.12s;white-space:nowrap}
.btn:hover{border-color:var(--muted)}
.btn.pri{background:var(--accent);color:#fff;border-color:var(--accent)}
.btn.pri:hover{filter:brightness(1.08)}
.btn.sm{padding:5px 10px;font-size:12px}
.btn.danger{color:var(--blocked);border-color:var(--blocked-soft)}
.btn:disabled{opacity:.5;cursor:not-allowed}

/* ── 指标卡 ── */
.metrics{display:grid;gap:13px;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));
  margin-bottom:18px}
.metric{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  padding:15px 17px}
.metric .k{font-size:11.5px;color:var(--muted);text-transform:uppercase;
  letter-spacing:.06em;font-weight:600;margin-bottom:7px}
.metric .v{font:680 27px/1.1 var(--mono);letter-spacing:-.02em}
.metric .d{font-size:12px;color:var(--muted);margin-top:5px}

/* ── 内容卡片网格 ── */
.grid{display:grid;gap:13px;grid-template-columns:repeat(auto-fill,minmax(310px,1fr))}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  padding:16px;display:flex;flex-direction:column;gap:12px;transition:.14s}
.card:hover{border-color:var(--accent);box-shadow:0 3px 14px -6px rgba(20,30,60,.16)}
.card.is-blocked{border-left:3px solid var(--blocked)}
.card-top{display:flex;align-items:flex-start;gap:12px}
.card-id{min-width:0;flex:1}
.card-id .path{font:600 13.5px/1.4 var(--mono);word-break:break-all;margin-bottom:4px}
.card-id .meta{font-size:12px;color:var(--muted)}
.card-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:4px}

/* 分数环：外圈浅色表示「修完能到哪」，一眼看到差距 */
.ring{position:relative;width:58px;height:58px;flex:none}
.ring svg{transform:rotate(-90deg);display:block}
.ring .num{position:absolute;inset:0;display:flex;align-items:center;
  justify-content:center;font:680 17px/1 var(--mono)}
.ring-legend{font-size:11px;color:var(--muted);text-align:center;margin-top:3px}

.tag{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:560;
  padding:2.5px 8px;border-radius:20px;white-space:nowrap}
.t-blocked{background:var(--blocked-soft);color:var(--blocked)}
.t-warn{background:var(--warn-soft);color:var(--warn)}
.t-ok{background:var(--gain-soft);color:var(--gain)}
.t-mute{background:var(--paper);color:var(--muted)}

/* ── 表格 ── */
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:11.5px;color:var(--muted);font-weight:600;
  text-transform:uppercase;letter-spacing:.05em;padding:9px 12px;
  border-bottom:1px solid var(--line)}
td{padding:11px 12px;border-bottom:1px solid var(--line);vertical-align:top}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--paper)}
.num{font-family:var(--mono);text-align:right;font-variant-numeric:tabular-nums}
code{font-family:var(--mono);font-size:12px;background:var(--paper);
  padding:1.5px 6px;border-radius:5px}

/* ── 优化建议行：序号 + 增益 + 耗时 ── */
.rec{display:grid;grid-template-columns:30px 1fr auto;gap:13px;
  padding:14px 0;border-bottom:1px solid var(--line);align-items:start}
.rec:last-child{border-bottom:0}
.rec-n{font:680 15px/1.3 var(--mono);color:var(--faint)}
.rec-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px}
.rec-title strong{font-size:14px;font-weight:600}
.rec-ev{font-size:12.5px;color:var(--muted);margin-bottom:5px}
.rec-fix{font-size:12.5px;color:var(--accent)}
.rec-cost{text-align:right;white-space:nowrap}
.rec-cost .g{font:680 15px/1.2 var(--mono);color:var(--gain)}
.rec-cost .m{font-size:11.5px;color:var(--muted);margin-top:2px}

/* 零数据引导：新站点没有搜索数据是常态，空图表不如讲清楚下一步 */
.onboard{padding:22px 24px}
.ob-head{margin-bottom:16px}
.ob-head strong{display:block;font-size:15px;margin-bottom:4px}
.ob-head span{font-size:13px;color:var(--muted)}
.ob-steps{list-style:none;counter-reset:ob;padding:0;margin:0 0 16px}
.ob-steps li{counter-increment:ob;position:relative;padding:0 0 14px 34px;
  border-left:2px solid var(--line);margin-left:11px}
.ob-steps li:last-child{border-left-color:transparent;padding-bottom:4px}
.ob-steps li::before{content:counter(ob);position:absolute;left:-12px;top:-2px;
  width:22px;height:22px;border-radius:50%;background:var(--paper);
  border:1px solid var(--line);display:flex;align-items:center;justify-content:center;
  font:600 11px/1 var(--mono);color:var(--muted)}
.ob-steps b{display:block;font-size:13.5px;margin-bottom:3px}
.ob-steps span{font-size:12.5px;color:var(--muted);line-height:1.6}
.ob-now{background:var(--accent-soft);border-radius:9px;padding:12px 14px;
  font-size:13px;line-height:1.65}
.ob-now b{color:var(--accent)}

/* 健康分主视觉：环形 + 分布 + 走势并排，参考 Ahrefs Site Audit 概览 */
.hero-health{display:grid;grid-template-columns:auto 1fr;gap:30px;align-items:center;
  background:var(--surface);border:1px solid var(--line);border-radius:14px;
  padding:22px 26px;margin-bottom:16px}
.ring-wrap{flex:none;display:flex;align-items:center;justify-content:center;
  width:132px;height:132px}
.ring-wrap svg{width:100%;height:100%}
.health-detail{min-width:0}
.hd-row{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px}
.hd-k{font-size:12.5px;color:var(--muted)}
.hd-v{font-size:13px;font-weight:640;font-family:var(--mono);
  font-variant-numeric:tabular-nums}
.hd-note{font-size:12.5px;color:var(--muted);padding:10px 0}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:9px}
.lg{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted)}
.lg b{font-family:var(--mono);color:var(--text);font-weight:640}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.d-excellent{background:var(--gain)}
.d-good{background:#5aa06f}
.d-fair{background:var(--warn)}
.d-poor{background:var(--blocked)}
@media(max-width:720px){.hero-health{grid-template-columns:1fr;gap:18px;text-align:center}
  .legend{justify-content:center}}

/* 问题分组：阻断发布与可选优化在视觉上必须一眼分得开 */
.issue-group + .issue-group{border-top:1px solid var(--line)}
.group-head{padding:11px 18px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.group-head strong{font-size:13px;font-weight:640}
.group-head span{font-size:12px;color:var(--muted)}
.group-head.g-block{background:var(--blocked-soft)}
.group-head.g-block strong{color:var(--blocked)}
.issue-row{display:flex;align-items:center;gap:14px;padding:12px 18px;
  border-top:1px solid var(--line)}
.issue-main{min-width:0;flex:1}
.issue-msg{font-size:13.5px;line-height:1.45}
.issue-meta{display:flex;gap:12px;flex-wrap:wrap;margin-top:4px;
  font-size:11.5px;color:var(--muted)}
.issue-meta code{font-family:var(--mono);font-size:11px;opacity:.75}
/* 发布漏斗：四步串联，箭头连接表达流转关系 */
.funnel{display:flex;align-items:stretch;gap:0;margin-top:14px}
.fn-step{flex:1;text-align:center;padding:10px 6px;position:relative;
  border-radius:8px;background:var(--paper);min-width:0}
.fn-step + .fn-step{margin-left:14px}
.fn-step + .fn-step::before{content:'';position:absolute;left:-11px;top:50%;
  width:8px;height:8px;border-top:1.5px solid var(--line);
  border-right:1.5px solid var(--line);transform:translateY(-50%) rotate(45deg)}
.fn-n{font:680 20px/1.1 var(--mono);color:var(--faint)}
.fn-k{font-size:11px;color:var(--muted);margin-top:3px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.fn-step.ok .fn-n{color:var(--gain)}
.fn-step.ok{background:var(--gain-soft)}
.fn-step.active .fn-n{color:var(--accent)}
.fn-step.active{background:var(--accent-soft)}
@media(max-width:640px){.funnel{flex-wrap:wrap;gap:8px}
  .fn-step{flex:1 1 44%;margin-left:0!important}
  .fn-step::before{display:none!important}}

/* 影响范围条：以覆盖页面最多的一条为满格，扫一眼看出相对广度 */
.impact-bar{height:4px;background:var(--line);border-radius:3px;margin-top:8px;
  max-width:340px;overflow:hidden}
.ib-fill{height:100%;background:var(--accent);border-radius:3px;
  transition:width .3s ease}
.ib-fill.blocked{background:var(--blocked)}

.issue-act{flex:none;font-size:12px;font-weight:600;white-space:nowrap;
  font-family:var(--mono);font-variant-numeric:tabular-nums}
.issue-act.blocked{color:var(--blocked)}
.issue-act.gain{color:var(--gain)}
@media(max-width:640px){.issue-row{flex-wrap:wrap;gap:6px}
  .issue-act{width:100%;text-align:left}}

.empty{text-align:center;padding:44px 20px;color:var(--muted);font-size:13.5px}
.empty strong{display:block;color:var(--text);font-size:15px;margin-bottom:6px}
.banner{padding:12px 15px;border-radius:10px;font-size:13px;margin-bottom:14px}
.banner.err{background:var(--blocked-soft);color:var(--blocked)}
.banner.ok{background:var(--gain-soft);color:var(--gain)}
.banner code{background:rgba(0,0,0,.06)}

dialog{border:0;border-radius:14px;padding:0;max-width:min(760px,92vw);width:100%;
  background:var(--surface);color:var(--text);box-shadow:0 24px 64px -20px rgba(10,18,40,.4)}
dialog::backdrop{background:rgba(10,16,30,.5)}
.dlg-head{padding:17px 20px;border-bottom:1px solid var(--line);
  display:flex;align-items:center;gap:11px}
.dlg-head h3{margin:0;font-size:15.5px;font-weight:640}
.dlg-body{padding:20px;max-height:66vh;overflow-y:auto}
.dlg-foot{padding:14px 20px;border-top:1px solid var(--line);
  display:flex;gap:9px;justify-content:flex-end}
label{display:block;margin-bottom:13px;font-size:13px;font-weight:540}
label input,label select,label textarea{display:block;width:100%;margin-top:5px;
  padding:8px 11px;border:1px solid var(--line);border-radius:8px;
  background:var(--paper);font-weight:400}
label textarea{font-family:var(--mono);font-size:12.5px;min-height:210px;resize:vertical}
label input:focus,label select:focus,label textarea:focus{
  outline:2px solid var(--accent);outline-offset:-1px}

/* ── 登录 ── */
.login{min-height:100vh;display:grid;place-items:center;padding:22px}
.login-box{width:100%;max-width:352px;background:var(--surface);
  border:1px solid var(--line);border-radius:14px;padding:30px 28px}
.login-box .brand{padding:0 0 20px;color:var(--text)}
.login-box h2{margin:0 0 5px;font-size:18px;font-weight:650}
.login-box .hint{color:var(--muted);font-size:12.5px;margin:0 0 20px}
.login-box .btn{width:100%;margin-top:5px}
.login-note{text-align:center;color:var(--faint);font-size:11.5px;margin:15px 0 0}

@media(max-width:860px){
  .app{grid-template-columns:1fr}
  .side{position:static;height:auto;flex-direction:row;align-items:center;
    overflow-x:auto;padding:0 10px}
  .brand{padding:12px 8px}
  .nav-label,.side-foot{display:none}
  .nav-group{display:flex;padding:0}
  .nav-item{white-space:nowrap;padding:14px 12px;border-radius:0}
}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`

/** 侧栏导航图标：线性 SVG，24px 网格 */
export const ICONS: Record<string, string> = {
  overview: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  contents: '<path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5"/>',
  sites: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  audit: '<path d="M4 5h16M4 12h16M4 19h10"/>',
  keys: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v4M15 12v3"/>',
  tenants: '<path d="M4 20V8l6-4 6 4v12M4 20h16M10 20v-5h4v5"/>',
}

export function icon(name: string): string {
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${ICONS[name] ?? ''}</svg>`
}

export const LOGO = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <rect width="32" height="32" rx="7" fill="#2f5fd8"/>
  <path d="M9 21V11h6a3 3 0 0 1 0 6h-3l5 4" stroke="#fff" stroke-width="2.4"
    stroke-linecap="round" stroke-linejoin="round"/>
</svg>`
