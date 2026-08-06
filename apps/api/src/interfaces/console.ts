import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  <strong>RankLoop</strong>
  <span class="muted" x-text="rulesCount ? rulesCount + ' 条规则' : ''"></span>
  <span style="flex:1"></span>
  <input type="password" placeholder="API Key (rkl_live_…)" x-model="key"
         @keydown.enter="connect()" autocomplete="off">
  <button @click="connect()" x-text="connected ? '刷新' : '连接'"></button>
</div>

<main>
  <template x-if="error"><div class="err" x-text="error"></div></template>
  <template x-if="notice"><div class="ok-msg" x-text="notice"></div></template>

  <template x-if="!connected">
    <article><h4>开始使用</h4>
      <p class="muted">输入 API Key 连接。首次使用可在服务器执行：</p>
      <pre><code>docker compose exec api node /app/seed.mjs</code></pre>
    </article>
  </template>

  <template x-if="connected">
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
              <table><thead><tr><th>名称</th><th>Origin</th><th class="right">内容数</th>
                <th>IndexNow</th><th></th></tr></thead>
              <tbody><template x-for="s in sites" :key="s.id">
                <tr><td x-text="s.name"></td>
                    <td><code x-text="s.origin"></code></td>
                    <td class="right" x-text="s.content_count"></td>
                    <td><span class="pill" :class="s.indexnow_configured?'p-ok':'p-draft'"
                          x-text="s.indexnow_configured?'已配置':'未配置'"></span></td>
                    <td class="right"><button @click="pickSite(s)" style="width:auto;padding:4px 10px;font-size:12px">查看内容</button></td></tr>
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
                      <button @click="inspect(c.id)" style="width:auto;padding:4px 10px;font-size:12px">详情</button>
                      <button @click="publish(c.id)" x-show="c.status!=='published'"
                              style="width:auto;padding:4px 10px;font-size:12px">发布</button>
                    </td></tr>
              </template></tbody></table>
            </template>
          </article>
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

<!-- 详情 -->
<dialog :open="detailOpen">
  <article>
    <header><strong x-text="detail?.path"></strong>
      <span class="muted" x-text="' · v'+(detail?.version??'')"></span></header>
    <template x-if="detail?.check">
      <div>
        <p>健康分 <strong :style="'color:'+scoreColor(detail.check.score)" x-text="detail.check.score"></strong>
           · <span x-text="detail.publishable ? '可发布' : '被门槛拦截'"></span></p>
        <template x-if="!detail.check.issues.length"><p class="muted">无问题</p></template>
        <table x-show="detail.check.issues.length">
          <thead><tr><th>规则</th><th>证据</th><th>修复建议</th></tr></thead>
          <tbody><template x-for="i in detail.check.issues" :key="i.code">
            <tr><td><span class="pill" :class="'p-'+i.severity" x-text="i.code"></span></td>
                <td class="muted" x-text="i.evidence"></td>
                <td x-text="i.recommendation"></td></tr>
          </template></tbody>
        </table>
        <template x-if="detail.check.skipped_rules?.length">
          <p class="muted" x-text="'已跳过 '+detail.check.skipped_rules.length+' 条规则（信息不足，未计入扣分）'"></p>
        </template>
      </div>
    </template>
    <footer><button @click="detailOpen=false" style="width:auto">关闭</button></footer>
  </article>
</dialog>

<script src="/assets/alpine.js" defer></script>
<script>
function app() {
  return {
    key: '', connected: false, error: '', notice: '', rulesCount: 0,
    tab: 'overview', tabs: [
      { id: 'overview', label: '总览' }, { id: 'sites', label: '站点' },
      { id: 'contents', label: '内容' }, { id: 'keys', label: 'API Key' },
    ],
    stats: {}, sites: [], contents: [], keys: [], newKey: '',
    editorOpen: false, detailOpen: false, detail: null,
    form: { siteName: '', siteOrigin: '', siteId: '', path: '', format: 'markdown', body: '', keyName: '' },

    async api(path, opts = {}) {
      // 只在真的有 body 时才带 Content-Type：
      // Fastify 对「声明 JSON 但 body 为空」的请求会直接 400
      const headers = { Authorization: 'Bearer ' + this.key, ...(opts.headers || {}) }
      if (opts.body) headers['Content-Type'] = 'application/json'
      const r = await fetch('/api/v1' + path, { ...opts, headers })
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
      const saved = sessionStorage.getItem('rankloop_key')
      if (saved) { this.key = saved; this.connect() }
    },

    async connect() {
      this.error = ''
      if (!this.key.trim()) { this.error = '请输入 API Key'; return }
      try {
        this.stats = await this.api('/stats/overview')
        this.sites = await this.api('/sites')
        this.keys = await this.api('/api-keys')
        this.connected = true
        sessionStorage.setItem('rankloop_key', this.key)
        if (this.form.siteId) await this.loadContents()
      } catch (e) { this.connected = false; this.error = e.message }
    },

    go(t) { this.tab = t; this.error = '' },

    async createSite() {
      this.error = ''
      try {
        await this.api('/sites', { method: 'POST', body: JSON.stringify({ name: this.form.siteName, origin: this.form.siteOrigin }) })
        this.form.siteName = ''; this.form.siteOrigin = ''
        this.sites = await this.api('/sites')
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
      try { this.detail = await this.api('/contents/' + id); this.detailOpen = true }
      catch (e) { this.error = e.message }
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

    async createKey() {
      this.error = ''; this.newKey = ''
      try {
        const scopes = ['sites:read','sites:write','contents:read','contents:write','contents:publish',
                        'issues:read','indexing:read','indexing:write','webhooks:write']
        const d = await this.api('/api-keys', { method: 'POST', body: JSON.stringify({ name: this.form.keyName || 'console key', scopes }) })
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

  app.get('/assets/alpine.js', asset('alpine.js', 'application/javascript; charset=utf-8'))
  app.get('/assets/pico.css', asset('pico.css', 'text/css; charset=utf-8'))

  app.get('/console', async (_req, reply) => reply.type('text/html; charset=utf-8').send(HTML))
}
