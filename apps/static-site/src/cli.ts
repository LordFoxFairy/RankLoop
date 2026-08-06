import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type BuildResult, build } from './build'

/**
 * 构建 CLI，供 GitHub Actions 调用。
 *
 * 退出码：
 *   0 = 全部通过
 *   1 = 存在 critical 问题（PR 检查据此失败，阻止不合格内容合入）
 */

function escapeXml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function writeSitemap(outDir: string, result: BuildResult): number {
  // 只列已发布页面：把被门槛拦下的 URL 放进 sitemap 会降低 Google 对它的信任
  const entries = result.pages.filter((p) => p.published)
  const urls = entries
    .map(
      (p) =>
        `  <url>\n    <loc>${escapeXml(p.url)}</loc>\n    <lastmod>${p.lastmod
          .toISOString()
          .slice(0, 10)}</lastmod>\n  </url>`,
    )
    .join('\n')

  writeFileSync(
    join(outDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    'utf8',
  )
  return entries.length
}

function writeRobots(outDir: string, siteUrl: string): void {
  writeFileSync(
    join(outDir, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`,
    'utf8',
  )
}

/** 供面板与 Actions 摘要读取的构建报告 */
function writeReport(outDir: string, result: BuildResult, siteUrl: string): void {
  writeFileSync(
    join(outDir, 'seo-report.json'),
    JSON.stringify(
      {
        site_url: siteUrl,
        generated_at: new Date().toISOString(),
        summary: {
          total: result.pages.length,
          built: result.built,
          blocked: result.blocked,
          average_score: result.averageScore,
        },
        pages: result.pages.map((p) => ({
          path: p.path,
          title: p.title,
          score: p.score,
          published: p.published,
          blocking: p.blocking,
        })),
      },
      null,
      2,
    ),
    'utf8',
  )
}

function main(): void {
  const siteUrl = (process.env.SITE_URL ?? 'http://localhost:4173').replace(/\/$/, '')
  const siteName = process.env.SITE_NAME ?? 'RankLoop Site'
  const contentDir = process.env.CONTENT_DIR ?? 'content'
  const outDir = process.env.OUT_DIR ?? 'dist-site'
  const ignoreGate = process.env.IGNORE_GATE === 'true'

  mkdirSync(outDir, { recursive: true })

  const defaultOgImage = process.env.OG_IMAGE ?? `${siteUrl}/og.png`
  const result = build({ contentDir, outDir, siteUrl, siteName, ignoreGate, defaultOgImage })
  const sitemapCount = writeSitemap(outDir, result)
  writeRobots(outDir, siteUrl)
  writeReport(outDir, result, siteUrl)

  console.log(`\n站点：${siteUrl}`)
  console.log(`内容：${result.pages.length} 篇，构建 ${result.built} 篇，拦截 ${result.blocked} 篇`)
  console.log(`平均健康分：${result.averageScore ?? '—'}`)
  console.log(`sitemap：${sitemapCount} 条 URL\n`)

  for (const p of result.pages) {
    const mark = p.published ? '✓' : '✗'
    const reason = p.published ? '' : `  阻塞：${p.blocking.join(', ')}`
    console.log(`  ${mark} ${p.path.padEnd(36)} ${String(p.score).padStart(3)} 分${reason}`)
  }

  if (result.blocked > 0 && !ignoreGate) {
    console.error(`\n✗ ${result.blocked} 篇内容存在 critical 问题，未构建。`)
    process.exit(1)
  }
  console.log('\n✓ 全部通过')
}

if (require.main === module) main()
