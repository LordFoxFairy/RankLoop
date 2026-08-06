import { JWT } from 'google-auth-library'
import { runGscAutomation } from './gsc'

/**
 * Google Search Console 自动化 CLI，供 GitHub Actions 调用。
 *
 * 两阶段设计：
 *   1. 构建前 `--write-token`：取验证令牌并写入产物，随站点一起部署
 *   2. 部署后（无参数）：请求校验 → 添加站点 → 提交 sitemap → 回读确认
 *
 * 首次运行时验证文件尚未上线，第 2 步会失败并如实说明；
 * 下一次发布时文件已在线，验证即可通过。之后每次发布全自动。
 */

function buildClient(credentials: string) {
  const creds = JSON.parse(credentials) as { client_email: string; private_key: string }
  return new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [
      'https://www.googleapis.com/auth/webmasters',
      'https://www.googleapis.com/auth/siteverification',
    ],
  })
}

async function main(): Promise<void> {
  const credentials = process.env.GSC_SERVICE_ACCOUNT
  const siteUrl = (process.env.SITE_URL ?? '').replace(/\/$/, '')
  const outDir = process.env.OUT_DIR ?? 'dist-site'
  const writeTokenOnly = process.argv.includes('--write-token')

  if (!credentials) {
    console.log('未配置 GSC_SERVICE_ACCOUNT，跳过 Google Search Console 自动化')
    return
  }
  if (!siteUrl) {
    console.error('缺少 SITE_URL')
    process.exit(1)
  }

  const client = buildClient(credentials)
  const results = await runGscAutomation({
    client: client as never,
    siteUrl: `${siteUrl}/`,
    sitemapUrl: `${siteUrl}/sitemap.xml`,
    outDir: writeTokenOnly ? outDir : undefined,
    writeTokenOnly,
  })

  console.log('\nGoogle Search Console 自动化：')
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.step}：${r.detail}`)
  }

  // 单步失败不应中断发布：验证文件首次部署前必然失败一次，属预期行为
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(
      summary,
      `\n### Google Search Console\n\n${results
        .map((r) => `- ${r.ok ? '✅' : '⚠️'} **${r.step}**：${r.detail}`)
        .join('\n')}\n`,
    )
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('GSC 自动化异常：', (e as Error).message)
    // 不让发布失败
    process.exit(0)
  })
}
