#!/usr/bin/env node
/**
 * 生成对外营销站。
 *
 * 静态站生成器只把 content/*.md 渲染成文档样式的页面——那适合文档，
 * 不适合首页。真正的营销页、开发者文档页、AI Agent 接入页都写在
 * apps/api/src/interfaces/ 下，本脚本把它们预渲染成静态 HTML，
 * 使 Cloudflare Pages 也能托管（Pages 跑不了 Node 服务）。
 *
 * 用法：
 *   npm run build --workspace @rankloop/seo-rules
 *   node apps/static-site/dist/cli.js      # 先出 content/*.md 的页面
 *   node scripts/build-marketing.mjs       # 再覆盖首页并补齐其余页面
 *
 * 这三个页面模块只依赖 fastify 的类型（无运行时依赖、不碰 Prisma），
 * 因此单独编译即可——不必先 build 整个 API。那样会要求
 * prisma generate，而 npm ci 装的是 any 存根，CI 里必然编译失败。
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)

const TMP = join(tmpdir(), 'rankloop-marketing-build')
rmSync(TMP, { recursive: true, force: true })
execFileSync(
  'npx',
  ['tsc', ...['landing', 'docs', 'skills'].map((n) => `apps/api/src/interfaces/${n}.ts`),
   '--outDir', TMP, '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck'],
  { stdio: 'inherit' },
)

const { renderLanding } = require(join(TMP, 'landing.js'))
const { renderDocs } = require(join(TMP, 'docs.js'))
const { renderSkills } = require(join(TMP, 'skills.js'))
const { listRules, parseContent, runRules } = require('../packages/seo-rules/dist/engine.js')

const OUT = process.env.OUT_DIR ?? 'dist-site'
const SITE = (process.env.SITE_URL ?? 'https://rankloop.miaokit.cloud').replace(/\/$/, '')

const rules = listRules()
const ruleCount = rules.length
const criticalCount = rules.filter((r) => r.severity === 'critical').length

mkdirSync(OUT, { recursive: true })

// 首页用营销页覆盖静态站生成的文档样式首页
writeFileSync(join(OUT, 'index.html'), renderLanding({ ruleCount, criticalCount, siteUrl: SITE }))

for (const [dir, html] of [
  ['docs', renderDocs(ruleCount)],
  ['skills', renderSkills(ruleCount)],
]) {
  mkdirSync(join(OUT, dir), { recursive: true })
  writeFileSync(join(OUT, dir, 'index.html'), html)
}

// 控制台需要数据库与后端服务，静态站托管不了。
// 但 Cloudflare Pages 会把找不到的路径回退到首页——用户点「进入控制台」
// 看到营销页会以为坏了。放一个说明页，如实告诉他控制台在哪。
const consoleUrl = process.env.CONSOLE_URL ?? ''
mkdirSync(join(OUT, 'console'), { recursive: true })
writeFileSync(
  join(OUT, 'console/index.html'),
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>控制台 — RankLoop</title>
<meta name="description" content="RankLoop 控制台入口说明：控制台为动态应用，需要独立部署的 API 服务。">
<meta name="robots" content="noindex">
<style>
:root{color-scheme:light dark;--fg:#0d1117;--bg:#fff;--muted:#5b6472;--line:#e6e9ee;
 --surface:#f7f8fa;--accent:#1a5fd0}
@media(prefers-color-scheme:dark){:root{--fg:#e8ebf0;--bg:#0c0f14;--muted:#9aa4b2;
 --line:#232833;--surface:#131720;--accent:#5b9bf8}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);display:flex;min-height:100vh;
 align-items:center;justify-content:center;padding:24px;
 font:16px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.card{max-width:520px;border:1px solid var(--line);border-radius:14px;padding:32px 34px;
 background:var(--surface)}
h1{font-size:1.5rem;margin:0 0 12px}
p{color:var(--muted);font-size:14.8px;margin:0 0 16px}
a{color:var(--accent)}
.btn{display:inline-block;padding:10px 20px;border-radius:9px;background:var(--accent);
 color:#fff;text-decoration:none;font-size:14.5px;font-weight:560}
.back{display:inline-block;margin-left:14px;color:var(--muted);text-decoration:none;font-size:14px}
code{background:var(--bg);padding:2px 7px;border-radius:5px;font-size:.88em;
 font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
</style></head><body>
<div class="card">
<h1>控制台需要单独部署</h1>
<p>控制台是动态应用，依赖数据库与后台任务，无法托管在静态站点上。
本站（营销页与文档）由 Cloudflare Pages 提供，API 与控制台需部署到能运行容器的环境。</p>
<p>仓库根目录的 <code>render.yaml</code> 已配置好数据库、缓存与迁移，
可一键部署；详见 <code>DEPLOY.md</code>。</p>
${
  consoleUrl
    ? `<p><a class="btn" href="${consoleUrl}">前往控制台</a>
<a class="back" href="/">返回首页</a></p>`
    : `<p><a class="btn" href="/docs">查看接入文档</a>
<a class="back" href="/">返回首页</a></p>`
}
</div></body></html>\n`,
)

// 营销页引用 /img/*，静态站生成器不搬运它们
if (existsSync('docs/images')) {
  mkdirSync(join(OUT, 'img'), { recursive: true })
  cpSync('docs/images', join(OUT, 'img'), { recursive: true })
}

// sitemap 需要包含新增页面，否则 Google 发现不了
const today = new Date().toISOString().slice(0, 10)
const paths = [
  '/',
  '/docs/',
  '/skills/',
  '/getting-started/',
  '/rules/',
  '/why-not-indexed/',
  '/publish-gate/',
]
writeFileSync(
  join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths
    .map((p) => `  <url>\n    <loc>${SITE}${p}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`)
    .join('\n')}\n</urlset>\n`,
)

// 用产品自己的规则检测自己的页面：说得出口的标准，自己先达到
let failed = false
for (const [name, file] of [
  ['首页', join(OUT, 'index.html')],
  ['docs', join(OUT, 'docs/index.html')],
  ['skills', join(OUT, 'skills/index.html')],
]) {
  const { doc } = parseContent({ format: 'html', body: readFileSync(file, 'utf8'), url: `${SITE}/` })
  const result = runRules(doc)
  const blocking = result.issues.filter((i) => i.severity === 'critical')
  console.log(`  ${blocking.length ? '✗' : '✓'} ${name.padEnd(8)} ${result.score} 分`)
  for (const i of blocking) console.log(`      ${i.code}: ${i.message}`)
  if (blocking.length) failed = true
}

if (failed) {
  console.error('\n营销站自身存在阻断发布的问题，拒绝构建')
  process.exit(1)
}
console.log(`\n✓ 营销站已生成（${ruleCount} 条规则，${paths.length} 个页面）`)
