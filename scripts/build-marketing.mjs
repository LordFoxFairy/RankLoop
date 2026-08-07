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

// 营销页引用 /img/*，静态站生成器不搬运它们
if (existsSync('docs/images')) {
  mkdirSync(join(OUT, 'img'), { recursive: true })
  cpSync('docs/images', join(OUT, 'img'), { recursive: true })
}

// sitemap 需要包含新增页面，否则 Google 发现不了
const today = new Date().toISOString().slice(0, 10)
const paths = ['/', '/docs/', '/skills/', '/getting-started/', '/rules/']
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
