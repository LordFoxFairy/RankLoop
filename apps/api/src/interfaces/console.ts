import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { CONSOLE_STYLES, LOGO, icon } from './console-shell'

/**
 * 管理控制台。
 *
 * 布局：左侧固定导航 + 内容区。取代原先的水平标签页——
 * 导航项随功能增长会挤不下，且无法分组。
 *
 * 技术选型：Alpine.js + 自写样式，本地内置无 CDN。
 * 不用 React/Next：需要独立构建产物与第二个进程，与单容器部署冲突。
 *
 * 数据全部来自 /api/v1 真实接口，无演示数据（规格 §0 第 7 条）。
 */

const NAV = [
  { group: '工作', items: [
    { id: 'overview', label: '总览' },
    { id: 'contents', label: '内容' },
    { id: 'sites', label: '站点' },
  ]},
  { group: '数据', items: [
    { id: 'search', label: '搜索表现' },
    { id: 'audit', label: '操作记录' },
  ]},
  { group: '管理', items: [
    { id: 'keys', label: '密钥' },
    { id: 'tenants', label: '租户' },
  ]},
] as const

const navHtml = NAV.map(
  (g) => `<div class="nav-group">
  <div class="nav-label">${g.group}</div>
  ${g.items
    .map(
      (i) => `<button class="nav-item" @click="go('${i.id}')"
    :aria-current="tab==='${i.id}'?'page':false">
    ${icon(i.id)}<span>${i.label}</span>
    ${i.id === 'contents' ? `<span class="badge" x-show="stats.blocked" x-text="stats.blocked"></span>` : ''}
  </button>`,
    )
    .join('\n  ')}
</div>`,
).join('\n')

const HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>控制台 — RankLoop</title>
<style>${CONSOLE_STYLES}</style>
</head>
<body x-data="app()" x-init="boot()">

<!-- 登录 -->
<template x-if="!me">
  <div class="login">
    <div class="login-box">
      <div class="brand">${LOGO} RankLoop</div>
      <h2>登录</h2>
      <p class="hint">管理内容质量与搜索表现</p>
      <template x-if="error"><div class="banner err" x-text="error"></div></template>
      <label>邮箱
        <input type="email" x-model="form.email" @keydown.enter="submitAuth()"
               placeholder="you@example.com" autocomplete="email">
      </label>
      <label>密码
        <input type="password" x-model="form.password" @keydown.enter="submitAuth()"
               autocomplete="current-password">
      </label>
      <button class="btn pri" @click="submitAuth()">登录</button>
      <p class="login-note">客户无需登录：由管理员分配密钥后直接调用接口</p>
    </div>
  </div>
</template>

<!-- 主界面 -->
<template x-if="me">
<div class="app">
  <aside class="side">
    <div class="brand">${LOGO} RankLoop</div>
    ${navHtml}
    <div class="side-foot">
      <div x-text="me.email" style="margin-bottom:6px;word-break:break-all"></div>
      <button @click="refresh()">刷新</button> ·
      <button @click="logout()">退出</button>
    </div>
  </aside>

  <div class="main">
    <div class="topbar">
      <h1 x-text="pageTitle()"></h1>
      <span class="sub" x-text="pageHint()"></span>
    </div>

    <div class="content">
      <template x-if="error"><div class="banner err" x-text="error"></div></template>
      <template x-if="notice"><div class="banner ok" x-text="notice"></div></template>

      <!-- 总览 -->
      <template x-if="tab==='overview'">
        <div>
          <!-- 健康分主视觉：参考 Ahrefs Site Audit，环形比数字更快传达
               「距离满分还差多少」；旁边配分布与走势，避免均值掩盖分化 -->
          <div class="hero-health">
            <div class="ring-wrap" x-html="heroRing(stats.health?.average_score, '132px')"></div>

            <div class="health-detail">
              <div class="hd-row">
                <span class="hd-k">内容分数分布</span>
                <span class="hd-v" x-text="(stats.contents?.total ?? 0)+' 篇'"></span>
              </div>
              <div x-html="distributionBar()"></div>
              <div class="legend">
                <template x-for="b in (stats.distribution || []).filter(x=>x.count)" :key="b.band">
                  <span class="lg"><i :class="'dot d-'+b.band"></i>
                    <span x-text="b.label"></span>
                    <b x-text="b.count"></b></span>
                </template>
              </div>

              <div class="hd-row" style="margin-top:16px">
                <span class="hd-k">近 30 天走势</span>
                <template x-if="scoreDelta() !== null">
                  <span class="hd-v" :style="'color:'+(scoreDelta()>=0?'var(--gain)':'var(--blocked)')"
                        x-text="(scoreDelta()>=0?'+':'')+scoreDelta()+' 分'"></span>
                </template>
              </div>
              <template x-if="scoreTrend.length >= 2">
                <div x-html="scoreSparkline()"></div>
              </template>
              <template x-if="scoreTrend.length < 2">
                <div class="hd-note">还需要一天的数据才能画出走势</div>
              </template>
            </div>
          </div>

          <div class="metrics">
            <div class="metric"><div class="k">可以发布</div>
              <div class="v" style="color:var(--gain)" x-text="stats.publishable ?? 0"></div>
              <div class="d">无阻断问题</div></div>
            <div class="metric"><div class="k">发不出去</div>
              <div class="v" :style="'color:'+(stats.blocked?'var(--blocked)':'var(--muted)')"
                   x-text="stats.blocked ?? 0"></div>
              <div class="d">存在严重问题</div></div>
            <div class="metric"><div class="k">已发布</div>
              <div class="v" x-text="stats.contents?.published ?? 0"></div>
              <div class="d" x-text="(stats.sites ?? 0)+' 个站点'"></div></div>
            <div class="metric"><div class="k">待修复问题</div>
              <div class="v" x-text="(stats.top_issues || []).reduce((s,i)=>s+i.count,0)"></div>
              <div class="d" x-text="(stats.top_issues?.length ?? 0)+' 类问题'"></div></div>
          </div>

          <div class="panel">
            <div class="panel-head"><h2>下一步该修什么</h2></div>

            <template x-if="!stats.top_issues?.length">
              <div class="empty"><strong>没有待处理的问题</strong>所有内容都已通过检测</div>
            </template>

            <!-- 阻断发布的问题：性质与下面完全不同，必须分开呈现 -->
            <template x-if="blockingIssues().length">
              <div class="issue-group">
                <div class="group-head g-block">
                  <strong>必须先修：这些页面发不出去</strong>
                  <span x-text="'共 '+blockedPages()+' 个页面被挡住，修完约需 '+fmtMinutes(blockingMinutes())"></span>
                </div>
                <template x-for="i in blockingIssues()" :key="i.code">
                  <div class="issue-row">
                    <div class="issue-main">
                      <div class="issue-msg" x-text="i.message"></div>
                      <div class="issue-meta">
                        <span x-text="i.count+' 个页面'"></span>
                        <span x-text="'约 '+fmtMinutes(i.minutes)"></span>
                        <code x-text="i.code"></code>
                      </div>
                    </div>
                    <div class="issue-act blocked">发布被阻断</div>
                  </div>
                </template>
              </div>
            </template>

            <!-- 可选优化：能发布，修了更好。用分数说明收益 -->
            <template x-if="optionalIssues().length">
              <div class="issue-group">
                <div class="group-head g-opt">
                  <strong>可以再优化：不影响发布</strong>
                  <span x-text="'按性价比排序，先做省时见效的。全部修完约需 '+fmtMinutes(optionalMinutes())"></span>
                </div>
                <template x-for="i in optionalIssues()" :key="i.code">
                  <div class="issue-row">
                    <div class="issue-main">
                      <div class="issue-msg" x-text="i.message"></div>
                      <div class="issue-meta">
                        <span x-text="i.count+' 个页面'"></span>
                        <span x-text="'约 '+fmtMinutes(i.minutes)"></span>
                        <code x-text="i.code"></code>
                      </div>
                    </div>
                    <!-- 每页加分而非总和：健康分满分 100，跨页累加会得出 +257 这种无意义的数 -->
                    <div class="issue-act gain" x-text="'每页 +'+perPageGain(i)+' 分'"></div>
                  </div>
                </template>
              </div>
            </template>
          </div>
        </div>
      </template>

      <!-- 内容：卡片网格 + 分数环 -->
      <template x-if="tab==='contents'">
        <div>
          <div class="toolbar">
            <select x-model="form.siteId" @change="loadContents()">
              <option value="">选择站点…</option>
              <template x-for="s in sites" :key="s.id">
                <option :value="s.id" x-text="s.name"></option>
              </template>
            </select>
            <span style="flex:1"></span>
            <button class="btn pri" @click="openEditor()" :disabled="!form.siteId">推送内容</button>
          </div>

          <template x-if="!form.siteId">
            <div class="panel"><div class="empty">
              <strong>先选一个站点</strong>内容按站点归属，选定后可查看与推送</div></div>
          </template>
          <template x-if="form.siteId && !contents.length">
            <div class="panel"><div class="empty">
              <strong>这个站点还没有内容</strong>推送第一篇，看看它的健康分</div></div>
          </template>

          <template x-if="contents.length">
            <div class="grid">
              <template x-for="c in contents" :key="c.id">
                <article class="card" :class="c.blocked ? 'is-blocked' : ''">
                  <div class="card-top">
                    <div class="card-id">
                      <div class="path" x-text="c.path"></div>
                      <div class="meta">
                        <span class="tag" :class="c.status==='published'?'t-ok':'t-mute'"
                              x-text="c.status==='published'?'已发布':'草稿'"></span>
                        <span x-text="' · '+c.format"></span>
                      </div>
                    </div>
                    <div>
                      <div class="ring" x-html="scoreRing(c.score)"></div>
                    </div>
                  </div>
                  <div class="card-acts">
                    <button class="btn sm" @click="inspect(c.id)">优化建议</button>
                    <button class="btn sm" @click="loadVersions(c.id)">版本</button>
                    <button class="btn sm pri" @click="publish(c.id)"
                            x-show="c.status!=='published' && !c.blocked">发布</button>
                    <span class="tag t-blocked" x-show="c.blocked"
                          x-text="c.blocking_count+' 项待修复'"></span>
                  </div>
                </article>
              </template>
            </div>
          </template>
        </div>
      </template>

      <!-- 站点 -->
      <template x-if="tab==='sites'">
        <div>
          <div class="toolbar">
            <input placeholder="站点名称" x-model="form.siteName">
            <input placeholder="https://example.com" x-model="form.siteOrigin">
            <button class="btn pri" @click="createSite()">添加站点</button>
          </div>
          <template x-if="!sites.length">
            <div class="panel"><div class="empty">
              <strong>还没有站点</strong>站点决定内容的对外地址</div></div>
          </template>
          <template x-if="sites.length">
            <div class="grid">
              <template x-for="s in sites" :key="s.id">
                <article class="card">
                  <div class="card-top"><div class="card-id">
                    <div class="path" style="font-family:var(--sans);font-size:15px"
                         x-text="s.name"></div>
                    <div class="meta"><a :href="s.live_url" target="_blank" rel="noopener"
                         x-text="s.live_url"></a></div>
                  </div></div>
                  <div class="meta" style="font-size:12.5px;color:var(--muted)">
                    <template x-if="s.domain">
                      <span class="tag" :class="s.domain_verified?'t-ok':'t-warn'"
                            x-text="s.domain + (s.domain_verified?' 已生效':' 待验证')"></span>
                    </template>
                    <template x-if="!s.domain"><span>使用平台子域名</span></template>
                    <span x-text="' · '+s.content_count+' 篇内容'"></span>
                  </div>
                  <div class="card-acts">
                    <button class="btn sm" @click="pickSite(s)">查看内容</button>
                    <button class="btn sm" @click="openDomain(s)">自有域名</button>
                  </div>
                </article>
              </template>
            </div>
          </template>
        </div>
      </template>

      <!-- 搜索表现 -->
      <template x-if="tab==='search'">
        <div>
          <div class="toolbar">
            <select x-model="form.siteId" @change="loadSearch()">
              <option value="">选择站点</option>
              <template x-for="s in sites" :key="s.id">
                <option :value="s.id" x-text="s.name"></option>
              </template>
            </select>
            <select x-model="searchDays" @change="loadSearch()">
              <option value="7">近 7 天</option>
              <option value="28">近 28 天</option>
              <option value="90">近 90 天</option>
            </select>
            <span style="flex:1"></span>
            <button class="btn" @click="syncSearch()" :disabled="!form.siteId || syncing"
                    x-text="syncing ? '同步中' : '同步数据'"></button>
          </div>

          <template x-if="!form.siteId">
            <div class="panel"><div class="empty">
              <strong>先选一个站点</strong>搜索数据按站点分别统计</div></div>
          </template>

          <!-- 零数据引导：新站点最常见的状态。参考 Google Search Console——
               与其显示空图表，不如说明数据什么时候来、现在该做什么。 -->
          <template x-if="form.siteId && perf && !perf.clicks && !perf.impressions">
            <div class="panel onboard">
              <div class="ob-head">
                <strong>还没有搜索数据</strong>
                <span>这是新站点的正常状态，不是配置错误</span>
              </div>
              <ol class="ob-steps">
                <li><b>内容被 Google 收录</b>
                  <span>已发布内容会自动进入 sitemap 并提交。新域名通常需要数周，
                        期间做什么都无法加速——Google 官方明确不保证收录时间。</span></li>
                <li><b>产生展现与点击</b>
                  <span>被收录后才会在搜索结果中出现。有展现即会在此显示。</span></li>
                <li><b>数据回传</b>
                  <span>Search Console 数据有 2–3 天延迟，最近几天的不会出现在结果中。</span></li>
              </ol>
              <div class="ob-now">
                <b>现在能做的</b>：把内容健康分修到 90 以上、补齐结构化数据、增加内链，
                这些是收录后能否排上去的前提条件。
              </div>
            </div>
          </template>

          <!-- 有数据才显示指标与图表；零数据时上面的引导已说明情况，
               再摆一排 0 和空图表只会自相矛盾 -->
          <template x-if="form.siteId && perf && (perf.clicks || perf.impressions)">
            <div>
              <div class="metrics">
                <div class="metric"><div class="k">点击</div>
                  <div class="v" x-text="perf.clicks"></div>
                  <div class="d" x-show="perf.change?.clicks_pct !== null"
                       :style="'color:'+(perf.change?.clicks>=0?'var(--gain)':'var(--blocked)')"
                       x-text="(perf.change?.clicks>=0?'↑ ':'↓ ')+Math.abs(perf.change?.clicks)+' ('+perf.change?.clicks_pct+'%)'"></div>
                </div>
                <div class="metric"><div class="k">曝光</div>
                  <div class="v" x-text="perf.impressions"></div></div>
                <div class="metric"><div class="k">点击率</div>
                  <div class="v" x-text="(perf.ctr*100).toFixed(2)+'%'"></div></div>
                <div class="metric"><div class="k">平均排名</div>
                  <div class="v" :style="'color:'+posColor(perf.position)"
                       x-text="perf.position || '—'"></div>
                  <div class="d" x-show="perf.position" x-text="rankHint(perf.position)"></div></div>
              </div>

              <template x-if="perf.note">
                <div class="banner" style="background:var(--paper);color:var(--muted)">
                  <span x-text="perf.note"></span>
                  <span x-show="perf.last_sync"
                        x-text="' 最近同步：'+(perf.last_sync?.rows)+' 行'"></span>
                </div>
              </template>

              <div class="panel" style="margin-bottom:14px">
                <div class="panel-head"><h2>点击趋势</h2></div>
                <div class="panel-body">
                  <template x-if="!trend.length"><div class="empty">暂无数据</div></template>
                  <div x-show="trend.length" x-html="trendChart()"></div>
                </div>
              </div>

              <div class="panel">
                <div class="panel-head"><h2>关键词</h2>
                  <span style="margin-left:auto;color:var(--muted);font-size:12px">按点击排序</span></div>
                <template x-if="!keywords.length">
                  <div class="empty"><strong>还没有关键词数据</strong>
                    内容被收录并产生展现后，这里会显示带来流量的词</div>
                </template>
                <template x-if="keywords.length">
                  <table><thead><tr><th>关键词</th><th class="num">点击</th>
                    <th class="num">曝光</th><th class="num">点击率</th>
                    <th class="num">排名</th></tr></thead>
                  <tbody><template x-for="k in keywords" :key="k.query">
                    <tr><td x-text="k.query"></td>
                        <td class="num" x-text="k.clicks"></td>
                        <td class="num" x-text="k.impressions"></td>
                        <td class="num" x-text="(k.ctr*100).toFixed(1)+'%'"></td>
                        <td class="num" :style="'color:'+posColor(k.position)"
                            x-text="k.position"></td></tr>
                  </template></tbody></table>
                </template>
              </div>
            </div>
          </template>
        </div>
      </template>

      <!-- 操作记录 -->
      <template x-if="tab==='audit'">
        <div class="panel">
          <div class="panel-head"><h2>操作记录</h2>
            <span style="margin-left:auto;color:var(--muted);font-size:12px">最近 100 条</span></div>
          <template x-if="!auditRows.length">
            <div class="empty"><strong>还没有记录</strong>内容的创建与发布会记录在这里</div>
          </template>
          <template x-if="auditRows.length">
            <table><thead><tr><th>时间</th><th>操作</th><th>对象</th><th>执行者</th></tr></thead>
            <tbody><template x-for="a in auditRows" :key="a.id">
              <tr><td style="color:var(--muted);white-space:nowrap"
                      x-text="new Date(a.at).toLocaleString('zh-CN')"></td>
                  <td x-text="actionLabel(a.action)"></td>
                  <td><code x-text="(a.metadata?.path) || a.resource"></code></td>
                  <td style="color:var(--muted)" x-text="a.actor"></td></tr>
            </template></tbody></table>
          </template>
        </div>
      </template>

      <!-- 密钥 -->
      <template x-if="tab==='keys'">
        <div>
          <div class="toolbar">
            <input placeholder="密钥名称" x-model="form.keyName">
            <button class="btn pri" @click="createKey()">创建密钥</button>
          </div>
          <template x-if="newKey">
            <div class="banner ok">新密钥（仅显示一次）：<code x-text="newKey"></code></div>
          </template>
          <div class="panel">
            <template x-if="!keys.length">
              <div class="empty"><strong>还没有密钥</strong>密钥用于第三方系统推送内容</div>
            </template>
            <template x-if="keys.length">
              <table><thead><tr><th>名称</th><th>前缀</th><th>最近使用</th><th></th></tr></thead>
              <tbody><template x-for="k in keys" :key="k.id">
                <tr><td x-text="k.name"></td>
                    <td><code x-text="k.prefix+'…'"></code></td>
                    <td style="color:var(--muted)"
                        x-text="k.last_used_at ? new Date(k.last_used_at).toLocaleString('zh-CN') : '从未'"></td>
                    <td style="text-align:right"><button class="btn sm danger"
                        @click="revokeKey(k.id)">吊销</button></td></tr>
              </template></tbody></table>
            </template>
          </div>
        </div>
      </template>

      <!-- 租户 -->
      <template x-if="tab==='tenants'">
        <div>
          <template x-if="!me?.is_platform_admin">
            <div class="panel"><div class="empty">
              <strong>需要平台管理员权限</strong>当前账号无法管理租户</div></div>
          </template>
          <template x-if="me?.is_platform_admin">
            <div>
              <div class="toolbar">
                <input placeholder="租户名称" x-model="form.tenantName">
                <input placeholder="标识（可选）" x-model="form.tenantSlug">
                <button class="btn pri" @click="createTenant()">创建并签发密钥</button>
              </div>
              <template x-if="newKey">
                <div class="banner ok">密钥（仅显示一次，请转交客户）：<code x-text="newKey"></code></div>
              </template>
              <template x-if="!tenants.length">
                <div class="panel"><div class="empty">
                  <strong>还没有租户</strong>创建租户后把密钥交给客户，他们即可推送内容</div></div>
              </template>
              <template x-if="tenants.length">
                <div class="grid">
                  <template x-for="t in tenants" :key="t.id">
                    <article class="card">
                      <div class="card-top"><div class="card-id">
                        <div class="path" style="font-family:var(--sans);font-size:15px"
                             x-text="t.name"></div>
                        <div class="meta"><code x-text="t.slug"></code></div>
                      </div></div>
                      <div style="display:flex;gap:16px;font-size:12.5px;color:var(--muted)">
                        <span><b class="num" style="color:var(--text)" x-text="t.site_count"></b> 站点</span>
                        <span><b class="num" style="color:var(--text)" x-text="t.content_count"></b> 内容</span>
                        <span><b class="num" style="color:var(--gain)" x-text="t.published_count"></b> 已发布</span>
                      </div>
                      <div class="card-acts">
                        <button class="btn sm" @click="issueKey(t)">补发密钥</button>
                      </div>
                    </article>
                  </template>
                </div>
              </template>
            </div>
          </template>
        </div>
      </template>

    </div>
  </div>
</div>
</template>

<!-- 优化建议 -->
<dialog x-ref="detailOpen" x-effect="detailOpen ? $refs.detailOpen.showModal() : $refs.detailOpen.close()" @close="detailOpen=false">
  <div class="dlg-head">
    <h3 x-text="detail?.path"></h3>
    <span style="color:var(--muted);font-size:12.5px" x-text="'v'+(detail?.version??'')"></span>
  </div>
  <div class="dlg-body">
    <template x-if="impact">
      <div class="metrics" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
        <div class="metric"><div class="k">现在</div>
          <div class="v" :style="'color:'+scoreColor(impact.current)" x-text="impact.current"></div></div>
        <div class="metric"><div class="k">先做快的</div>
          <div class="v" style="color:var(--accent)" x-text="impact.quickWin"></div>
          <div class="d" x-text="impact.quickMinutes+' 分钟'"></div></div>
        <div class="metric"><div class="k">全部修完</div>
          <div class="v" style="color:var(--gain)" x-text="impact.potential"></div>
          <div class="d" x-text="impact.totalMinutes+' 分钟'"></div></div>
        <div class="metric"><div class="k">阻断发布</div>
          <div class="v" :style="'color:'+(impact.blockingCount?'var(--blocked)':'var(--gain)')"
               x-text="impact.blockingCount"></div></div>
      </div>
    </template>

    <template x-if="!recs.length">
      <div class="empty"><strong>没有待优化项</strong>这篇内容已通过全部检测</div>
    </template>
    <template x-if="recs.length">
      <div>
        <template x-for="(r,idx) in recs" :key="r.code">
          <div class="rec">
            <div class="rec-n" x-text="idx+1"></div>
            <div>
              <div class="rec-title">
                <strong x-text="r.message"></strong>
                <span class="tag t-blocked" x-show="r.blocking">发不出去</span>
              </div>
              <div class="rec-ev" x-text="r.evidence"></div>
              <div class="rec-fix" x-text="r.recommendation"></div>
            </div>
            <div class="rec-cost">
              <div class="g" x-text="'+'+r.gain"></div>
              <div class="m" x-text="r.minutes+' 分钟'"></div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
  <div class="dlg-foot"><button class="btn" @click="detailOpen=false">关闭</button></div>
</dialog>

<!-- 推送内容 -->
<dialog x-ref="editorOpen" x-effect="editorOpen ? $refs.editorOpen.showModal() : $refs.editorOpen.close()" @close="editorOpen=false">
  <div class="dlg-head"><h3>推送内容</h3></div>
  <div class="dlg-body">
    <label>路径<input x-model="form.path" placeholder="/my-article"></label>
    <label>格式
      <select x-model="form.format">
        <option value="markdown">Markdown（frontmatter 提供元数据）</option>
        <option value="html">HTML</option>
      </select>
    </label>
    <label>正文<textarea x-model="form.body"
      placeholder="---&#10;title: 标题&#10;description: 描述&#10;---&#10;&#10;# 正文"></textarea></label>
  </div>
  <div class="dlg-foot">
    <button class="btn" @click="editorOpen=false">取消</button>
    <button class="btn pri" @click="submitContent()">推送并检测</button>
  </div>
</dialog>

<!-- 自有域名 -->
<dialog x-ref="domainOpen" x-effect="domainOpen ? $refs.domainOpen.showModal() : $refs.domainOpen.close()" @close="domainOpen=false">
  <div class="dlg-head"><h3>自有域名</h3>
    <span style="color:var(--muted);font-size:12.5px" x-text="domainSite?.name"></span></div>
  <div class="dlg-body">
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px">
      绑定后内容以该域名对外渲染，搜索权重归属客户自己的域名。
    </p>
    <label>域名<input x-model="form.domain" placeholder="blog.example.com"></label>
    <template x-if="domainInfo">
      <div class="banner ok">
        <strong>配置 DNS：</strong>
        <ol style="margin:8px 0 0;padding-left:20px">
          <li x-text="domainInfo.instructions.step1"></li>
          <li x-text="domainInfo.instructions.step2"></li>
        </ol>
      </div>
    </template>
  </div>
  <div class="dlg-foot">
    <button class="btn" @click="domainOpen=false">关闭</button>
    <button class="btn danger" @click="unbindDomain()" x-show="domainSite?.domain">解绑</button>
    <button class="btn" @click="bindDomain()">绑定</button>
    <button class="btn pri" @click="verifyDomain()"
            x-show="domainSite?.domain || domainInfo">验证</button>
  </div>
</dialog>

<!-- 版本历史 -->
<dialog x-ref="versionsOpen" x-effect="versionsOpen ? $refs.versionsOpen.showModal() : $refs.versionsOpen.close()" @close="versionsOpen=false">
  <div class="dlg-head"><h3>版本历史</h3></div>
  <div class="dlg-body">
    <template x-if="!versions.length"><div class="empty">暂无版本</div></template>
    <template x-if="versions.length">
      <table><thead><tr><th>版本</th><th class="num">健康分</th>
        <th>问题</th><th>时间</th></tr></thead>
      <tbody><template x-for="v in versions" :key="v.id">
        <tr><td><span x-text="'v'+v.version"></span>
                <span class="tag t-ok" x-show="v.is_current" style="margin-left:6px">当前</span></td>
            <td class="num" :style="'color:'+scoreColor(v.score)" x-text="v.score ?? '—'"></td>
            <td><template x-if="v.counts"><span>
                  <span class="tag t-blocked" x-show="v.counts.critical"
                        x-text="v.counts.critical+' 严重'"></span>
                  <span class="tag t-warn" x-show="v.counts.warning"
                        x-text="v.counts.warning+' 警告'"></span>
                </span></template></td>
            <td style="color:var(--muted)"
                x-text="new Date(v.created_at).toLocaleString('zh-CN')"></td></tr>
      </template></tbody></table>
    </template>
  </div>
  <div class="dlg-foot"><button class="btn" @click="versionsOpen=false">关闭</button></div>
</dialog>

<script src="/assets/alpine.js" defer></script>
<script>
function app() {
  return {
    me: null, error: '', notice: '', rulesCount: 0, tenants: [],
    perf: null, keywords: [], trend: [], searchDays: '28', syncing: false, auditRows: [],
    scoreTrend: [],
    recs: [], impact: null,
    tab: 'overview', tabs: [
      { id: 'overview', label: '总览' },
      { id: 'sites', label: '站点' },
      { id: 'contents', label: '内容' },
      { id: 'search', label: '搜索表现' },
      { id: 'audit', label: '审计' },
      { id: 'keys', label: 'API Key' },
      { id: 'tenants', label: '租户' },
    ],
    stats: {}, sites: [], contents: [], keys: [], newKey: '',
    editorOpen: false, detailOpen: false, detail: null,
    domainOpen: false, domainSite: null, domainInfo: null,
    versionsOpen: false, versions: [],
    form: { email: '', password: '', tenantName: '', tenantSlug: '', siteName: '', siteOrigin: '',
            siteId: '', path: '', format: 'markdown', body: '', keyName: '', domain: '' },

    async api(path, opts = {}) {
      // 会话走 HttpOnly Cookie；只在真的有 body 时才带 Content-Type，
      // 因为 Fastify 对「声明 JSON 但 body 为空」的请求会直接 400
      const headers = { ...(opts.headers || {}) }
      if (opts.body) headers['Content-Type'] = 'application/json'
      const r = await fetch('/api/v1' + path, { ...opts, headers, credentials: 'same-origin' })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        const d = body?.error?.details
        const extra = d?.blocking ? '（' + d.blocking.join('、') + '）' : ''
        throw new Error((body?.error?.message || 'HTTP ' + r.status) + extra)
      }
      return body.data
    },

    scoreColor(s) {
      if (s === null || s === undefined) return 'var(--muted)'
      return s >= 80 ? 'var(--gain)' : s >= 60 ? 'var(--warn)' : 'var(--blocked)'
    },

    /**
     * 健康分环形图。
     *
     * 参考 Ahrefs Site Audit 的健康分展示：环形比数字更快传达
     * 「距离满分还差多少」。用 stroke-dasharray 画弧，无需图表库。
     */
    /** 主视觉大环。与卡片用的小环 scoreRing 分开——同名会被后定义的覆盖 */
    heroRing(score, size) {
      const s = score ?? 0
      const r = 42, c = 2 * Math.PI * r
      const dash = (s / 100) * c
      const col = this.scoreColor(score)
      return '<svg viewBox="0 0 100 100" style="width:' + size + ';height:' + size + '" ' +
        'role="img" aria-label="健康分 ' + (score ?? '暂无') + '">' +
        '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="9"/>' +
        (score === null || score === undefined ? '' :
          '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="9" ' +
          'stroke-linecap="round" stroke-dasharray="' + dash.toFixed(1) + ' ' + c.toFixed(1) + '" ' +
          'transform="rotate(-90 50 50)"/>') +
        '<text x="50" y="52" text-anchor="middle" dominant-baseline="middle" ' +
        'font-size="30" font-weight="700" fill="' + col + '" ' +
        'font-family="ui-monospace,monospace">' + (score ?? '—') + '</text>' +
        '<text x="50" y="70" text-anchor="middle" font-size="9" fill="var(--muted)">满分 100</text>' +
        '</svg>'
    },

    /**
     * 分数分布条。
     *
     * 参考 Ahrefs 的分档堆叠：均分掩盖分化——「均分 87」可能是
     * 全部 87，也可能一半 100 一半 74，后者才需要行动。
     */
    distributionBar() {
      const d = this.stats.distribution || []
      const total = d.reduce((s, x) => s + x.count, 0)
      if (!total) return ''
      const colors = { excellent: 'var(--gain)', good: '#5aa06f',
                       fair: 'var(--warn)', poor: 'var(--blocked)' }
      let x = 0
      const segs = d.filter(b => b.count > 0).map(b => {
        const w = (b.count / total) * 100
        const rect = '<rect x="' + x.toFixed(2) + '" y="0" width="' + w.toFixed(2) + '" height="10" ' +
          'fill="' + colors[b.band] + '"><title>' + b.label + '：' + b.count + ' 篇</title></rect>'
        x += w
        return rect
      }).join('')
      return '<svg viewBox="0 0 100 10" preserveAspectRatio="none" ' +
        'style="width:100%;height:10px;border-radius:5px;overflow:hidden" ' +
        'role="img" aria-label="内容分数分布">' + segs + '</svg>'
    },

    /**
     * 健康分走势迷你图。
     *
     * 参考 Google Search Console：仍在收集中的数据用虚线画，
     * 避免用户把尚未稳定的数值当成结论。
     */
    scoreSparkline() {
      const d = this.scoreTrend || []
      if (d.length < 2) return ''
      const w = 260, h = 44, pad = 4
      const vals = d.map(x => x.average_score)
      const lo = Math.min(...vals, 60), hi = 100
      const xs = i => pad + i * (w - pad * 2) / (d.length - 1)
      const ys = v => h - pad - ((v - lo) / (hi - lo || 1)) * (h - pad * 2)
      const path = d.map((x, i) => (i ? 'L' : 'M') + xs(i).toFixed(1) + ' ' + ys(x.average_score).toFixed(1)).join(' ')
      const last = d[d.length - 1]
      return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:44px" ' +
        'role="img" aria-label="健康分走势">' +
        '<path d="' + path + '" fill="none" stroke="' + this.scoreColor(last.average_score) +
        '" stroke-width="2" stroke-linejoin="round"/>' +
        '<circle cx="' + xs(d.length - 1).toFixed(1) + '" cy="' + ys(last.average_score).toFixed(1) +
        '" r="3" fill="' + this.scoreColor(last.average_score) + '"/>' +
        '</svg>'
    },

    /** 与区间起点相比的变化，用于「比上周 +5」这类判断 */
    scoreDelta() {
      const d = this.scoreTrend || []
      if (d.length < 2) return null
      return d[d.length - 1].average_score - d[0].average_score
    },

    flash(msg) { this.notice = msg; setTimeout(() => { this.notice = '' }, 4000) },

    async boot() {
      try { this.rulesCount = (await (await fetch('/api/v1/rules')).json()).data.length } catch {}
      // 已有会话则直接进入，无需重新登录
      try { this.me = await this.api('/me'); await this.refresh() } catch { this.me = null }
    },

    async submitAuth() {
      this.error = ''
      try {
        await this.api('/auth/login', { method: 'POST',
          body: JSON.stringify({ email: this.form.email, password: this.form.password }) })
        this.form.password = ''
        this.me = await this.api('/me')
        await this.refresh()
      } catch (e) { this.error = e.message }
    },

    async logout() {
      try { await this.api('/auth/logout', { method: 'POST' }) } catch {}
      this.me = null; this.mode = 'login'
      this.sites = []; this.contents = []; this.keys = []; this.stats = {}
    },

    async refresh() {
      this.error = ''
      try {
        this.stats = await this.api('/stats/overview')
        // 走势与总览并行取：没有历史对比，单个分数说明不了变好还是变差
        this.scoreTrend = await this.api('/stats/trend?days=30').catch(() => [])
        this.sites = await this.enrichSites(await this.api('/sites'))
        this.keys = await this.api('/api-keys').catch(() => [])
        if (this.me?.is_platform_admin) {
          this.tenants = await this.api('/admin/tenants').catch(() => [])
        }
        if (this.form.siteId) await this.loadContents()
      } catch (e) { this.error = e.message }
    },

    go(t) {
      this.tab = t; this.error = ''
      if (t === 'search' && this.form.siteId) this.loadSearch()
      if (t === 'audit') this.loadAudit()
    },

    async createSite() {
      this.error = ''
      try {
        await this.api('/sites', { method: 'POST', body: JSON.stringify({ name: this.form.siteName, origin: this.form.siteOrigin }) })
        this.form.siteName = ''; this.form.siteOrigin = ''
        this.sites = await this.enrichSites(await this.api('/sites'))
        this.flash('站点已创建')
      } catch (e) { this.error = e.message }
    },

    pickSite(s) { this.form.siteId = s.id; this.tab = 'contents'; this.loadContents() },

    async loadContents() {
      if (!this.form.siteId) { this.contents = []; return }
      this.error = ''
      try { this.contents = await this.api('/sites/' + this.form.siteId + '/contents') }
      catch (e) { this.error = e.message }
    },

    openEditor() { this.form.path = ''; this.form.body = ''; this.editorOpen = true },

    async submitContent() {
      this.error = ''
      try {
        const d = await this.api('/sites/' + this.form.siteId + '/contents', {
          method: 'POST',
          body: JSON.stringify({ path: this.form.path, format: this.form.format, body: this.form.body }),
        })
        this.editorOpen = false
        await this.loadContents()
        this.stats = await this.api('/stats/overview')
        this.flash('已提交，健康分 ' + d.check.score + (d.publishable ? '（可发布）' : '（存在 critical 问题）'))
      } catch (e) { this.error = e.message }
    },

    async inspect(id) {
      this.error = ''
      try {
        const [d, r] = await Promise.all([
          this.api('/contents/' + id),
          this.api('/contents/' + id + '/recommendations'),
        ])
        this.detail = d
        this.recs = r.items ?? []
        this.impact = r.impact
        this.detailOpen = true
      } catch (e) { this.error = e.message }
    },

    async publish(id) {
      this.error = ''
      try {
        await this.api('/contents/' + id + '/publish', { method: 'POST' })
        await this.loadContents()
        this.stats = await this.api('/stats/overview')
        this.flash('已发布')
      } catch (e) { this.error = e.message }
    },

    // 列表接口不含域名信息，逐个补详情（站点数量有限，可接受）
    async enrichSites(list) {
      return Promise.all(list.map(async (s) => {
        try { return { ...s, ...(await this.api('/sites/' + s.id)) } }
        catch { return s }
      }))
    },

    openDomain(site) {
      this.domainSite = site
      this.form.domain = site.domain || ''
      this.domainInfo = null
      this.domainOpen = true
    },

    async bindDomain() {
      this.error = ''
      try {
        this.domainInfo = await this.api('/sites/' + this.domainSite.id + '/domain', {
          method: 'POST', body: JSON.stringify({ domain: this.form.domain }),
        })
        this.flash('已绑定，请按提示配置 DNS 后验证')
      } catch (e) { this.error = e.message }
    },

    async verifyDomain() {
      this.error = ''
      try {
        const r = await this.api('/sites/' + this.domainSite.id + '/domain/verify', { method: 'POST' })
        if (r.verified) {
          this.flash('域名验证通过，已生效：' + r.live_url)
          this.domainOpen = false
          this.sites = await this.enrichSites(await this.api('/sites'))
        } else {
          this.error = r.reason || '验证未通过'
        }
      } catch (e) { this.error = e.message }
    },

    async unbindDomain() {
      if (!confirm('解绑后将回退到平台子域名，确定继续？')) return
      this.error = ''
      try {
        await this.api('/sites/' + this.domainSite.id + '/domain', { method: 'DELETE' })
        this.domainOpen = false
        this.sites = await this.enrichSites(await this.api('/sites'))
        this.flash('已解绑')
      } catch (e) { this.error = e.message }
    },

    async loadVersions(id) {
      this.error = ''
      try {
        this.versions = await this.api('/contents/' + id + '/versions')
        this.versionsOpen = true
      } catch (e) { this.error = e.message }
    },


    // ── 视图辅助 ──
    pageTitle() {
      return ({ overview: '总览', contents: '内容', sites: '站点', search: '搜索表现',
                audit: '操作记录', keys: '密钥', tenants: '租户' })[this.tab] ?? ''
    },
    pageHint() {
      return ({
        overview: '内容质量与发布状态一览',
        contents: '推送内容、查看优化建议、发布上线',
        sites: '站点与对外域名',
        search: '内容发布后的真实搜索表现',
        audit: '谁在什么时候改了什么',
        keys: '第三方系统凭密钥推送内容',
        tenants: '创建租户并分配密钥',
      })[this.tab] ?? ''
    },
    sevLabel(s) { return ({ critical: '严重', warning: '警告', notice: '建议' })[s] ?? s },
    tagClass(s) { return ({ critical: 't-blocked', warning: 't-warn', notice: 't-mute' })[s] ?? 't-mute' },
    // 超过一小时用「1.5 小时」比「90 分钟」更容易估量工作量
    fmtMinutes(m) { return m >= 60 ? (m / 60).toFixed(1).replace(/\.0$/, '') + ' 小时' : m + ' 分钟' },
    // 阻断发布与可选优化是两件事，分开取用
    blockingIssues() { return (this.stats.top_issues ?? []).filter((i) => i.blocking) },
    optionalIssues() { return (this.stats.top_issues ?? []).filter((i) => !i.blocking) },
    blockingMinutes() { return this.blockingIssues().reduce((s, i) => s + i.minutes, 0) },
    optionalMinutes() { return this.optionalIssues().reduce((s, i) => s + i.minutes, 0) },
    // recoverable 是跨页总和，除以页数还原成「每页能加多少分」——
    // 健康分是单页 0-100，跨页累加没有意义
    perPageGain(i) { return i.count > 0 ? Math.round(i.recoverable / i.count) : 0 },
    // 用后端算好的阻塞内容数，不能拿问题条数当页面数——一个页面可能有多条问题
    blockedPages() { return this.stats.blocked ?? 0 },
    actionLabel(a) {
      return ({
        'content.created': '推送内容', 'content.updated': '更新内容',
        'content.published': '发布内容', 'site.created': '创建站点',
        'site.domain_bound': '绑定域名', 'tenant.created': '创建租户',
      })[a] ?? a
    },
    rankHint(p) {
      if (!p) return ''
      return p <= 10 ? '首页区间' : p <= 20 ? '第二页' : p <= 30 ? '第三页' : '较靠后'
    },

    /**
     * 分数环：外圈浅色标出「修完能到哪」，一眼看到差距，
     * 不用读两个数字自己相减。
     */
    scoreRing(score) {
      if (score === null || score === undefined) {
        return '<div class="ring"><div class="num" style="color:var(--faint)">—</div></div>'
      }
      const r = 24, c = 2 * Math.PI * r
      const done = (score / 100) * c
      const color = this.scoreColor(score)
      return '<svg width="58" height="58" viewBox="0 0 58 58">' +
        '<circle cx="29" cy="29" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="5"/>' +
        '<circle cx="29" cy="29" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="5" ' +
        'stroke-linecap="round" stroke-dasharray="' + done.toFixed(1) + ' ' + c.toFixed(1) + '"/>' +
        '</svg><div class="num" style="color:' + color + '">' + score + '</div>'
    },

    // 排名越小越好：1-10 在首页，10-30 第二三页，之后基本无流量
    posColor(p) {
      if (!p) return 'var(--muted)'
      return p <= 10 ? 'var(--gain)' : p <= 30 ? 'var(--warn)' : 'var(--blocked)'
    },

    async loadAudit() {
      this.error = ''
      try { this.auditRows = await this.api('/audit?limit=100') }
      catch (e) { this.error = e.message }
    },

    async loadSearch() {
      if (!this.form.siteId) { this.perf = null; return }
      this.error = ''
      const q = '?days=' + this.searchDays
      try {
        const [p, k, t] = await Promise.all([
          this.api('/sites/' + this.form.siteId + '/search-performance' + q),
          this.api('/sites/' + this.form.siteId + '/keywords' + q),
          this.api('/sites/' + this.form.siteId + '/search-trend' + q),
        ])
        this.perf = p; this.keywords = k; this.trend = t
      } catch (e) { this.error = e.message }
    },

    async syncSearch() {
      this.error = ''; this.syncing = true
      try {
        const r = await this.api('/sites/' + this.form.siteId + '/search-performance/sync', {
          method: 'POST', body: JSON.stringify({ days: Number(this.searchDays) }),
        })
        this.flash('已同步 ' + r.rows_synced + ' 行（' + r.start_date + ' ~ ' + r.end_date + '）')
        await this.loadSearch()
      } catch (e) { this.error = e.message }
      finally { this.syncing = false }
    },

    // 内联 SVG 折线，避免引入图表库
    trendChart() {
      const d = this.trend
      if (d.length < 2) return '<div class="empty">数据不足两天，无法绘制趋势</div>'
      const w = 640, h = 160, pad = 28
      const max = Math.max(1, ...d.map(x => x.clicks))
      const xs = i => pad + i * (w - pad * 2) / (d.length - 1)
      const ys = v => h - pad - (v / max) * (h - pad * 2)
      const line = d.map((x, i) => (i ? 'L' : 'M') + xs(i).toFixed(1) + ' ' + ys(x.clicks).toFixed(1)).join(' ')
      const area = line + ' L' + xs(d.length - 1).toFixed(1) + ' ' + (h - pad) + ' L' + pad + ' ' + (h - pad) + ' Z'
      const dots = d.map((x, i) =>
        '<circle cx="' + xs(i).toFixed(1) + '" cy="' + ys(x.clicks).toFixed(1) +
        '" r="2.5" fill="var(--accent)"><title>' + x.date + '：' + x.clicks +
        ' 次点击 · ' + x.impressions + ' 次曝光</title></circle>').join('')
      return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:160px" ' +
        'role="img" aria-label="点击趋势折线图">' +
        '<line x1="' + pad + '" y1="' + (h - pad) + '" x2="' + (w - pad) + '" y2="' + (h - pad) +
        '" stroke="var(--line)"/>' +
        '<text x="4" y="' + (pad + 4) + '" fill="var(--muted)" font-size="10">' + max + '</text>' +
        '<path d="' + area + '" fill="var(--accent)" opacity=".1"/>' +
        '<path d="' + line + '" fill="none" stroke="var(--accent)" stroke-width="2"/>' +
        dots + '</svg>'
    },

    async createTenant() {
      this.error = ''; this.newKey = ''
      try {
        const d = await this.api('/admin/tenants', { method: 'POST',
          body: JSON.stringify({ name: this.form.tenantName,
                                 slug: this.form.tenantSlug || undefined }) })
        this.newKey = d.api_key
        this.form.tenantName = ''; this.form.tenantSlug = ''
        this.tenants = await this.api('/admin/tenants')
        this.flash('租户已创建')
      } catch (e) { this.error = e.message }
    },

    async issueKey(t) {
      this.error = ''; this.newKey = ''
      try {
        const d = await this.api('/admin/tenants/' + t.id + '/keys', { method: 'POST',
          body: JSON.stringify({ name: t.name + ' 的密钥' }) })
        this.newKey = d.api_key
        this.flash('已补发，请转交客户')
      } catch (e) { this.error = e.message }
    },

    async createKey() {
      this.error = ''; this.newKey = ''
      try {
        const ws = this.me?.workspaces?.[0]
        if (!ws) { this.error = '当前账号没有工作区'; return }
        const d = await this.api('/me/api-keys', { method: 'POST',
          body: JSON.stringify({ workspaceId: ws.id, name: this.form.keyName || 'console key' }) })
        this.newKey = d.api_key
        this.form.keyName = ''
        this.keys = await this.api('/api-keys')
      } catch (e) { this.error = e.message }
    },

    async revokeKey(id) {
      if (!confirm('吊销后使用该 Key 的调用会立即失败，确定继续？')) return
      this.error = ''
      try { await this.api('/api-keys/' + id, { method: 'DELETE' }); this.keys = await this.api('/api-keys'); this.flash('已吊销') }
      catch (e) { this.error = e.message }
    },
  }
}
</script>
</body>
</html>`

export async function consoleRoutes(app: FastifyInstance): Promise<void> {
  const assetDir = join(__dirname, '../../public')

  const asset = (file: string, type: string) => {
    // 启动时读入内存：文件很小且不会变，避免每次请求读盘
    const content = readFileSync(join(assetDir, file), 'utf8')
    return async (_req: unknown, reply: { type: (t: string) => { header: (k: string, v: string) => { send: (c: string) => unknown } } }) =>
      reply.type(type).header('cache-control', 'public, max-age=31536000, immutable').send(content)
  }

  // 品牌图片：启动时读入内存并注册路由。
  // 遍历目录而非逐个列出，新增图片无需改代码。
  const imgDir = join(assetDir, 'img')
  if (existsSync(imgDir)) {
    const TYPES: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
    }
    for (const file of readdirSync(imgDir)) {
      const type = TYPES[extname(file).toLowerCase()]
      if (!type) continue
      // 二进制读取：PNG 按 utf8 读会损坏
      const buf = readFileSync(join(imgDir, file))
      app.get(`/img/${file}`, async (_req, reply) =>
        reply
          .type(type)
          .header('cache-control', 'public, max-age=31536000, immutable')
          .send(buf),
      )
    }
  }

  app.get('/assets/alpine.js', asset('alpine.js', 'application/javascript; charset=utf-8'))
  app.get('/assets/pico.css', asset('pico.css', 'text/css; charset=utf-8'))

  app.get('/console', async (_req, reply) => reply.type('text/html; charset=utf-8').send(HTML))
}
