import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { FastifyInstance } from 'fastify'

/**
 * 管理控制台。
 *
 * 技术选型：Alpine.js + Pico CSS，两者均本地内置（无 CDN 依赖）。
 * 不使用 Next.js/React：那需要独立构建产物与第二个进程，
 * 与「单容器一键部署」冲突；本控制台的交互复杂度也用不上。
 *
 * 所有数据来自 /api/v1 真实接口，无演示数据（规格 §0 第 7 条）。
 */

const HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/pico.css">
<title>RankLoop 管理控制台</title>
<style>
:root{--pico-font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
body{padding:0}
.topbar{display:flex;align-items:center;gap:14px;padding:12px 22px;
  border-bottom:1px solid var(--pico-muted-border-color);flex-wrap:wrap}
.topbar strong{font-size:16px}
.topbar input{margin:0;width:290px;font-size:13px}
.topbar button{margin:0;width:auto;padding:7px 14px;font-size:13px}
main{padding:20px 22px;max-width:1240px;margin:0 auto}
/* Pico 给 nav 的直接子元素加了 flex:1，会把标签拉满整行 */
nav.tabs{display:flex;gap:6px;margin-bottom:18px;flex-wrap:wrap;justify-content:flex-start}
nav.tabs>button{flex:0 0 auto}
/* Pico 的 button 默认是白字（配深色底），未选中态背景透明会导致文字不可见，
   必须显式指定前景色而非依赖 --pico-color */
nav.tabs button{width:auto;margin:0;padding:6px 15px;font-size:13px;
  background:transparent;color:var(--pico-contrast);
  border:1px solid var(--pico-muted-border-color)}
nav.tabs button:hover{background:var(--pico-secondary-background);
  color:var(--pico-secondary-inverse)}
nav.tabs button[aria-current="page"]{background:var(--pico-primary);
  color:var(--pico-primary-inverse);border-color:var(--pico-primary)}
.cards{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:20px}
article{margin:0;padding:16px}
article h4{margin:0 0 6px;font-size:12px;text-transform:uppercase;
  letter-spacing:.5px;color:var(--pico-muted-color);font-weight:500}
.big{font-size:28px;font-weight:700;line-height:1.2;font-variant-numeric:tabular-nums}
table{font-size:13px;margin:0}
th{font-size:12px;color:var(--pico-muted-color)}
td,th{padding:8px 10px}
.pill{font-size:11px;padding:2px 8px;border-radius:99px;white-space:nowrap;
  display:inline-block;font-weight:500}
.p-critical{background:#fde8e8;color:#b42318}
.p-warning{background:#fef3e2;color:#b54708}
.p-notice{background:#e6f0fd;color:#175cd3}
.p-ok{background:#e6f7ee;color:#067647}
.p-draft{background:var(--pico-muted-border-color);color:var(--pico-muted-color)}
@media(prefers-color-scheme:dark){
  .p-critical{background:#3f1d1d;color:#fda4a4}
  .p-warning{background:#3d2c12;color:#fcd34d}
  .p-notice{background:#16304f;color:#93c5fd}
  .p-ok{background:#0f3323;color:#6ee7b7}
}
.right{text-align:right}
.muted{color:var(--pico-muted-color);font-size:12px}
.err{background:#fde8e8;color:#b42318;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:13px}
.ok-msg{background:#e6f7ee;color:#067647;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:13px}
code{font-size:12px}
dialog article{max-width:640px}
textarea{font-family:ui-monospace,monospace;font-size:12px;min-height:220px}
.inline{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px}
.inline input,.inline select{margin:0;width:auto;min-width:170px;font-size:13px}
.inline button{margin:0;width:auto;padding:7px 14px;font-size:13px}
.bar{height:6px;border-radius:3px;background:var(--pico-muted-border-color);overflow:hidden}
.bar>i{display:block;height:100%}
.empty{text-align:center;padding:28px;color:var(--pico-muted-color);font-size:13px}
</style>
</head>
<body x-data="app()" x-init="boot()">

<div class="topbar">
  <a href="/" style="text-decoration:none;color:inherit"><strong>RankLoop</strong></a>
  <span class="muted" x-text="rulesCount ? rulesCount + ' 条规则' : ''"></span>
  <span style="flex:1"></span>
  <template x-if="me">
    <span class="muted" x-text="me.email"></span>
  </template>
  <template x-if="me">
    <button @click="refresh()" class="secondary">刷新</button>
  </template>
  <template x-if="me">
    <button @click="logout()" class="secondary">退出</button>
  </template>
</div>

<main>
  <template x-if="error"><div class="err" x-text="error"></div></template>
  <template x-if="notice"><div class="ok-msg" x-text="notice"></div></template>

  <template x-if="!me">
    <article style="max-width:400px;margin:40px auto">
      <h4>管理员登录</h4>
      <label>邮箱
        <input type="email" x-model="form.email" @keydown.enter="submitAuth()"
               placeholder="you@example.com" autocomplete="email">
      </label>
      <label>密码
        <input type="password" x-model="form.password" @keydown.enter="submitAuth()"
               placeholder="密码" autocomplete="current-password">
      </label>
      <button @click="submitAuth()">登录</button>
      <p class="muted" style="text-align:center;margin:12px 0 0;font-size:12px">
        客户无需登录——由管理员分配 API Key 后直接调用接口
      </p>
    </article>
  </template>

  <template x-if="me">
    <div>
      <nav class="tabs">
        <template x-for="t in tabs" :key="t.id">
          <button @click="go(t.id)" :aria-current="tab===t.id?'page':false" x-text="t.label"></button>
        </template>
      </nav>

      <!-- 总览 -->
      <template x-if="tab==='overview'">
        <div>
          <div class="cards">
            <article><h4>平均健康分</h4>
              <div class="big" :style="'color:'+scoreColor(stats.health?.average_score)"
                   x-text="stats.health?.average_score ?? '暂无'"></div>
              <div class="bar" style="margin-top:8px">
                <i :style="'width:'+(stats.health?.average_score||0)+'%;background:'+scoreColor(stats.health?.average_score)"></i>
              </div></article>
            <article><h4>内容总数</h4><div class="big" x-text="stats.contents?.total ?? 0"></div>
              <div class="muted" x-text="'已发布 '+(stats.contents?.published??0)+' · 草稿 '+(stats.contents?.draft??0)"></div></article>
            <article><h4>可发布</h4><div class="big" style="color:#067647" x-text="stats.publishable ?? 0"></div>
              <div class="muted">无 critical 问题</div></article>
            <article><h4>被拦截</h4><div class="big" style="color:#b42318" x-text="stats.blocked ?? 0"></div>
              <div class="muted">存在 critical 问题</div></article>
          </div>
          <article><h4>最常见问题</h4>
            <template x-if="!stats.top_issues?.length"><div class="empty">暂无问题 🎉</div></template>
            <template x-if="stats.top_issues?.length">
              <table><thead><tr><th>规则</th><th>级别</th><th class="right">次数</th></tr></thead>
              <tbody><template x-for="i in stats.top_issues" :key="i.code">
                <tr><td><code x-text="i.code"></code></td>
                    <td><span class="pill" :class="'p-'+i.severity" x-text="i.severity"></span></td>
                    <td class="right" x-text="i.count"></td></tr>
              </template></tbody></table>
            </template>
          </article>
        </div>
      </template>

      <!-- 站点 -->
      <template x-if="tab==='sites'">
        <div>
          <div class="inline">
            <input placeholder="站点名称" x-model="form.siteName">
            <input placeholder="https://example.com" x-model="form.siteOrigin">
            <button @click="createSite()">添加站点</button>
          </div>
          <article>
            <template x-if="!sites.length"><div class="empty">还没有站点</div></template>
            <template x-if="sites.length">
              <table><thead><tr><th>名称</th><th>访问地址</th><th>自有域名</th>
                <th class="right">内容</th><th></th></tr></thead>
              <tbody><template x-for="s in sites" :key="s.id">
                <tr><td x-text="s.name"></td>
                    <td><a :href="s.live_url" target="_blank" rel="noopener"><code x-text="s.live_url"></code></a></td>
                    <td><template x-if="s.domain">
                          <span class="pill" :class="s.domain_verified?'p-ok':'p-warning'"
                            x-text="s.domain + (s.domain_verified?'':'（待验证）')"></span>
                        </template>
                        <template x-if="!s.domain"><span class="muted">未绑定</span></template></td>
                    <td class="right" x-text="s.content_count"></td>
                    <td class="right">
                      <button @click="pickSite(s)" style="width:auto;padding:4px 10px;font-size:12px">内容</button>
                      <button @click="openDomain(s)" style="width:auto;padding:4px 10px;font-size:12px" class="secondary">域名</button>
                    </td></tr>
              </template></tbody></table>
            </template>
          </article>
        </div>
      </template>

      <!-- 内容 -->
      <template x-if="tab==='contents'">
        <div>
          <div class="inline">
            <select x-model="form.siteId" @change="loadContents()">
              <option value="">选择站点…</option>
              <template x-for="s in sites" :key="s.id">
                <option :value="s.id" x-text="s.name+' ('+s.origin+')'"></option>
              </template>
            </select>
            <button @click="openEditor()" :disabled="!form.siteId">提交内容</button>
          </div>
          <article>
            <template x-if="!form.siteId"><div class="empty">请先选择站点</div></template>
            <template x-if="form.siteId && !contents.length"><div class="empty">该站点还没有内容</div></template>
            <template x-if="contents.length">
              <table><thead><tr><th>路径</th><th>格式</th><th>状态</th>
                <th class="right">健康分</th><th></th></tr></thead>
              <tbody><template x-for="c in contents" :key="c.id">
                <tr><td><code x-text="c.path"></code></td>
                    <td x-text="c.format"></td>
                    <td><span class="pill" :class="c.status==='published'?'p-ok':'p-draft'" x-text="c.status"></span></td>
                    <td class="right" :style="'color:'+scoreColor(c.score)" x-text="c.score ?? '—'"></td>
                    <td class="right">
                      <button @click="inspect(c.id)" style="width:auto;padding:4px 10px;font-size:12px">优化建议</button>
                      <button @click="loadVersions(c.id)" style="width:auto;padding:4px 10px;font-size:12px" class="secondary">版本</button>
                      <button @click="publish(c.id)" x-show="c.status!=='published'"
                              style="width:auto;padding:4px 10px;font-size:12px">发布</button>
                    </td></tr>
              </template></tbody></table>
            </template>
          </article>
        </div>
      </template>

      <!-- 搜索表现 -->
      <template x-if="tab==='search'">
        <div>
          <div class="inline">
            <select x-model="form.siteId" @change="loadSearch()">
              <option value="">选择站点…</option>
              <template x-for="s in sites" :key="s.id">
                <option :value="s.id" x-text="s.name"></option>
              </template>
            </select>
            <select x-model="searchDays" @change="loadSearch()">
              <option value="7">近 7 天</option>
              <option value="28">近 28 天</option>
              <option value="90">近 90 天</option>
            </select>
            <button @click="syncSearch()" :disabled="!form.siteId || syncing"
                    x-text="syncing ? '同步中…' : '从 Search Console 同步'"></button>
          </div>

          <template x-if="!form.siteId"><div class="empty">请先选择站点</div></template>

          <template x-if="form.siteId && perf">
            <div>
              <div class="cards">
                <article><h4>点击</h4>
                  <div class="big" x-text="perf.clicks"></div>
                  <div class="muted" x-show="perf.change?.clicks_pct !== null"
                       :style="'color:'+(perf.change?.clicks>=0?'#067647':'#b42318')"
                       x-text="(perf.change?.clicks>=0?'▲ +':'▼ ')+perf.change?.clicks+' ('+perf.change?.clicks_pct+'%)'"></div>
                </article>
                <article><h4>曝光</h4><div class="big" x-text="perf.impressions"></div></article>
                <article><h4>点击率</h4>
                  <div class="big" x-text="(perf.ctr*100).toFixed(2)+'%'"></div></article>
                <article><h4>平均排名</h4>
                  <div class="big" :style="'color:'+posColor(perf.position)"
                       x-text="perf.position || '—'"></div></article>
              </div>

              <template x-if="perf.note">
                <article style="margin-bottom:14px">
                  <p class="muted" style="margin:0" x-text="perf.note"></p>
                  <p class="muted" style="margin:6px 0 0;font-size:11px"
                     x-show="perf.last_sync"
                     x-text="'最近同步：'+(perf.last_sync?.status)+' · '+(perf.last_sync?.rows)+' 行'"></p>
                </article>
              </template>

              <article style="margin-bottom:14px"><h4>趋势</h4>
                <template x-if="!trend.length"><div class="empty">暂无数据</div></template>
                <div x-show="trend.length" x-html="trendChart()"></div>
              </article>

              <article><h4>关键词排行</h4>
                <template x-if="!keywords.length"><div class="empty">暂无关键词数据</div></template>
                <template x-if="keywords.length">
                  <table><thead><tr><th>关键词</th><th class="right">点击</th>
                    <th class="right">曝光</th><th class="right">CTR</th>
                    <th class="right">排名</th></tr></thead>
                  <tbody><template x-for="k in keywords" :key="k.query">
                    <tr><td x-text="k.query"></td>
                        <td class="right" x-text="k.clicks"></td>
                        <td class="right" x-text="k.impressions"></td>
                        <td class="right" x-text="(k.ctr*100).toFixed(1)+'%'"></td>
                        <td class="right" :style="'color:'+posColor(k.position)"
                            x-text="k.position"></td></tr>
                  </template></tbody></table>
                </template>
              </article>
            </div>
          </template>
        </div>
      </template>

      <!-- 审计日志 -->
      <template x-if="tab==='audit'">
        <article>
          <h4>操作记录</h4>
          <template x-if="!auditRows.length"><div class="empty">暂无记录</div></template>
          <template x-if="auditRows.length">
            <table><thead><tr><th>时间</th><th>操作</th><th>对象</th>
              <th>执行者</th></tr></thead>
            <tbody><template x-for="a in auditRows" :key="a.id">
              <tr><td class="muted" x-text="new Date(a.at).toLocaleString('zh-CN')"></td>
                  <td><code x-text="a.action"></code></td>
                  <td class="muted" x-text="(a.metadata?.path) || a.resource_id || a.resource"></td>
                  <td class="muted" x-text="a.actor"></td></tr>
            </template></tbody></table>
          </template>
        </article>
      </template>

      <!-- 租户（仅管理员） -->
      <template x-if="tab==='tenants'">
        <div>
          <template x-if="!me?.is_platform_admin">
            <div class="empty">需要平台管理员权限</div>
          </template>
          <template x-if="me?.is_platform_admin">
            <div>
              <div class="inline">
                <input placeholder="租户名称" x-model="form.tenantName">
                <input placeholder="slug（可选）" x-model="form.tenantSlug">
                <button @click="createTenant()">创建租户并签发 Key</button>
              </div>
              <template x-if="newKey">
                <div class="ok-msg">
                  新 API Key（仅显示一次，请转交客户）：<code x-text="newKey"></code>
                </div>
              </template>
              <article>
                <template x-if="!tenants.length"><div class="empty">还没有租户</div></template>
                <template x-if="tenants.length">
                  <table><thead><tr><th>租户</th><th>slug</th><th class="right">站点</th>
                    <th class="right">内容</th><th class="right">已发布</th><th></th></tr></thead>
                  <tbody><template x-for="t in tenants" :key="t.id">
                    <tr><td x-text="t.name"></td>
                        <td><code x-text="t.slug"></code></td>
                        <td class="right" x-text="t.site_count"></td>
                        <td class="right" x-text="t.content_count"></td>
                        <td class="right" x-text="t.published_count"></td>
                        <td class="right"><button @click="issueKey(t)"
                              style="width:auto;padding:4px 10px;font-size:12px" class="secondary">补发 Key</button></td></tr>
                  </template></tbody></table>
                </template>
              </article>
            </div>
          </template>
        </div>
      </template>

      <!-- API Key -->
      <template x-if="tab==='keys'">
        <div>
          <div class="inline">
            <input placeholder="Key 名称" x-model="form.keyName">
            <button @click="createKey()">创建（全部权限）</button>
          </div>
          <template x-if="newKey">
            <div class="ok-msg">新 Key（仅显示一次）：<code x-text="newKey"></code></div>
          </template>
          <article>
            <table><thead><tr><th>名称</th><th>前缀</th><th>最近使用</th><th></th></tr></thead>
            <tbody><template x-for="k in keys" :key="k.id">
              <tr><td x-text="k.name"></td><td><code x-text="k.prefix+'…'"></code></td>
                  <td class="muted" x-text="k.last_used_at ? new Date(k.last_used_at).toLocaleString('zh-CN') : '从未'"></td>
                  <td class="right"><button @click="revokeKey(k.id)"
                        style="width:auto;padding:4px 10px;font-size:12px" class="secondary">吊销</button></td></tr>
            </template></tbody></table>
          </article>
        </div>
      </template>
    </div>
  </template>
</main>

<!-- 提交内容 -->
<dialog :open="editorOpen">
  <article>
    <header><strong>提交内容</strong></header>
    <label>路径 <input x-model="form.path" placeholder="/my-article"></label>
    <label>格式
      <select x-model="form.format">
        <option value="markdown">Markdown（frontmatter 提供元数据）</option>
        <option value="html">HTML</option>
      </select>
    </label>
    <label>正文 <textarea x-model="form.body" placeholder="---&#10;title: 标题&#10;---&#10;&#10;# 正文"></textarea></label>
    <footer>
      <button class="secondary" @click="editorOpen=false" style="width:auto">取消</button>
      <button @click="submitContent()" style="width:auto">提交并检测</button>
    </footer>
  </article>
</dialog>

<!-- 优化建议（按性价比排序） -->
<dialog :open="detailOpen">
  <article style="max-width:760px">
    <header><strong x-text="detail?.path"></strong>
      <span class="muted" x-text="' · v'+(detail?.version??'')"></span></header>

    <template x-if="impact">
      <div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
        <article><h4>当前</h4>
          <div class="big" :style="'color:'+scoreColor(impact.current)" x-text="impact.current"></div></article>
        <article><h4>全部修完</h4>
          <div class="big" style="color:#067647" x-text="impact.potential"></div>
          <div class="muted" x-text="'约 '+impact.totalMinutes+' 分钟'"></div></article>
        <article><h4>先做快的</h4>
          <div class="big" style="color:#175cd3" x-text="impact.quickWin"></div>
          <div class="muted" x-text="'仅需 '+impact.quickMinutes+' 分钟'"></div></article>
        <article><h4>阻断发布</h4>
          <div class="big" :style="'color:'+(impact.blockingCount?'#b42318':'#067647')"
               x-text="impact.blockingCount"></div></article>
      </div>
    </template>

    <template x-if="!recs.length"><div class="empty">无待优化项 🎉</div></template>
    <template x-if="recs.length">
      <table><thead><tr><th>优先做</th><th class="right">+分</th>
        <th class="right">耗时</th><th>问题与建议</th></tr></thead>
      <tbody><template x-for="(r,idx) in recs" :key="r.code">
        <tr>
          <td style="white-space:nowrap">
            <strong x-text="(idx+1)+'.'"></strong>
            <span class="pill" :class="'p-'+r.severity" x-text="r.code"></span>
            <span class="pill p-critical" x-show="r.blocking">阻断</span>
          </td>
          <td class="right" style="color:#067647;font-weight:600" x-text="'+'+r.gain"></td>
          <td class="right muted" x-text="r.minutes+' 分'"></td>
          <td>
            <div x-text="r.message"></div>
            <div class="muted" style="margin-top:3px" x-text="r.evidence"></div>
            <div style="margin-top:4px;font-size:12px;color:var(--pico-primary)"
                 x-text="'→ '+r.recommendation"></div>
          </td>
        </tr>
      </template></tbody></table>
    </template>

    <footer><button @click="detailOpen=false" style="width:auto">关闭</button></footer>
  </article>
</dialog>

<!-- 域名管理 -->
<dialog :open="domainOpen">
  <article>
    <header><strong>自有域名</strong>
      <span class="muted" x-text="domainSite?.name"></span></header>
    <p class="muted">
      绑定自有域名后，内容以该域名对外渲染，SEO 权重归属客户自己的域名——
      这是平台子域名做不到的。
    </p>
    <label>域名
      <input x-model="form.domain" placeholder="blog.example.com">
    </label>
    <template x-if="domainInfo">
      <div class="ok-msg">
        <strong>请配置 DNS：</strong>
        <ol style="margin:8px 0 0;padding-left:20px">
          <li x-text="domainInfo.instructions.step1"></li>
          <li x-text="domainInfo.instructions.step2"></li>
        </ol>
      </div>
    </template>
    <footer>
      <button class="secondary" @click="domainOpen=false" style="width:auto">关闭</button>
      <button @click="unbindDomain()" class="secondary" style="width:auto"
              x-show="domainSite?.domain">解绑</button>
      <button @click="bindDomain()" style="width:auto">绑定</button>
      <button @click="verifyDomain()" style="width:auto" x-show="domainSite?.domain || domainInfo">验证</button>
    </footer>
  </article>
</dialog>

<!-- 版本历史 -->
<dialog :open="versionsOpen">
  <article>
    <header><strong>版本历史</strong>
      <span class="muted">分数变化可追溯</span></header>
    <template x-if="!versions.length"><div class="empty">暂无版本</div></template>
    <template x-if="versions.length">
      <table><thead><tr><th>版本</th><th class="right">健康分</th>
        <th>问题</th><th>时间</th></tr></thead>
      <tbody><template x-for="v in versions" :key="v.id">
        <tr><td><span x-text="'v'+v.version"></span>
                <span class="pill p-ok" x-show="v.is_current">当前</span></td>
            <td class="right" :style="'color:'+scoreColor(v.score)" x-text="v.score ?? '—'"></td>
            <td><template x-if="v.counts">
                  <span>
                    <span class="pill p-critical" x-show="v.counts.critical" x-text="v.counts.critical"></span>
                    <span class="pill p-warning" x-show="v.counts.warning" x-text="v.counts.warning"></span>
                    <span class="pill p-notice" x-show="v.counts.notice" x-text="v.counts.notice"></span>
                  </span>
                </template></td>
            <td class="muted" x-text="new Date(v.created_at).toLocaleString('zh-CN')"></td></tr>
      </template></tbody></table>
    </template>
    <footer><button @click="versionsOpen=false" style="width:auto">关闭</button></footer>
  </article>
</dialog>

<script src="/assets/alpine.js" defer></script>
<script>
function app() {
  return {
    me: null, error: '', notice: '', rulesCount: 0, tenants: [],
    perf: null, keywords: [], trend: [], searchDays: '28', syncing: false, auditRows: [],
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
      if (s === null || s === undefined) return 'var(--pico-muted-color)'
      return s >= 80 ? '#067647' : s >= 60 ? '#b54708' : '#b42318'
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

    // 排名越小越好：1-10 在首页，10-30 第二三页，之后基本无流量
    posColor(p) {
      if (!p) return 'var(--pico-muted-color)'
      return p <= 10 ? '#067647' : p <= 30 ? '#b54708' : '#b42318'
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
        '" r="2.5" fill="var(--pico-primary)"><title>' + x.date + '：' + x.clicks +
        ' 次点击 · ' + x.impressions + ' 次曝光</title></circle>').join('')
      return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:160px" ' +
        'role="img" aria-label="点击趋势折线图">' +
        '<line x1="' + pad + '" y1="' + (h - pad) + '" x2="' + (w - pad) + '" y2="' + (h - pad) +
        '" stroke="var(--pico-muted-border-color)"/>' +
        '<text x="4" y="' + (pad + 4) + '" fill="var(--pico-muted-color)" font-size="10">' + max + '</text>' +
        '<path d="' + area + '" fill="var(--pico-primary)" opacity=".1"/>' +
        '<path d="' + line + '" fill="none" stroke="var(--pico-primary)" stroke-width="2"/>' +
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
