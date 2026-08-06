import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { type GscClient, runGscAutomation, writeVerificationFile } from './gsc'

const SITE = 'https://example.com/'
const SITEMAP = 'https://example.com/sitemap.xml'

/** 按 URL 匹配返回预设响应的 Google API 替身 */
function fakeClient(handlers: Record<string, unknown>, failing: string[] = []): GscClient {
  return {
    request: vi.fn(async ({ url }: { url: string }) => {
      for (const f of failing) {
        if (url.includes(f)) throw new Error(`模拟失败：${f}`)
      }
      for (const [key, data] of Object.entries(handlers)) {
        if (url.includes(key)) return { data, status: 200 }
      }
      return { data: {}, status: 200 }
    }),
  }
}

describe('验证文件', () => {
  it('写入 Google 要求的文件名与内容格式', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gsc-'))
    const token = 'google1234abcd.html'
    writeVerificationFile(dir, token)
    const content = readFileSync(join(dir, token), 'utf8')
    expect(content).toBe(`google-site-verification: ${token}\n`)
  })
})

describe('GSC 自动化流程', () => {
  it('完整成功路径依次执行四个步骤', async () => {
    const client = fakeClient({
      '/token': { token: 'googleabc.html' },
      '/sitemaps/': { lastDownloaded: '2026-08-06', warnings: '0', errors: '0' },
    })
    const dir = mkdtempSync(join(tmpdir(), 'gsc-'))
    const results = await runGscAutomation({
      client,
      siteUrl: SITE,
      sitemapUrl: SITEMAP,
      outDir: dir,
    })

    expect(results.map((r) => r.step)).toEqual([
      '生成验证文件',
      '验证所有权',
      '添加站点',
      '提交 sitemap',
      '确认 sitemap 状态',
    ])
    expect(results.every((r) => r.ok)).toBe(true)
  })

  it('--write-token 模式只写文件，不做后续调用', async () => {
    const client = fakeClient({ '/token': { token: 'googleabc.html' } })
    const dir = mkdtempSync(join(tmpdir(), 'gsc-'))
    const results = await runGscAutomation({
      client,
      siteUrl: SITE,
      sitemapUrl: SITEMAP,
      outDir: dir,
      writeTokenOnly: true,
    })
    expect(results).toHaveLength(1)
    expect(results[0].step).toBe('生成验证文件')
    expect(readFileSync(join(dir, 'googleabc.html'), 'utf8')).toContain('google-site-verification')
  })

  it('验证失败时中止后续步骤并说明原因', async () => {
    // 首次发布时验证文件还没上线，这是预期行为而非故障
    const client = fakeClient({ '/token': { token: 'googleabc.html' } }, ['webResource'])
    const dir = mkdtempSync(join(tmpdir(), 'gsc-'))
    const results = await runGscAutomation({
      client,
      siteUrl: SITE,
      sitemapUrl: SITEMAP,
      outDir: dir,
    })

    expect(results).toHaveLength(2)
    expect(results[1].ok).toBe(false)
    expect(results[1].detail).toContain('尚未部署')
  })

  it('提交 sitemap 失败不影响状态回读，如实报告', async () => {
    const client = fakeClient({ '/token': { token: 'googleabc.html' } }, ['sitemaps/'])
    const dir = mkdtempSync(join(tmpdir(), 'gsc-'))
    const results = await runGscAutomation({
      client,
      siteUrl: SITE,
      sitemapUrl: SITEMAP,
      outDir: dir,
    })
    const submit = results.find((r) => r.step === '提交 sitemap')
    const confirm = results.find((r) => r.step === '确认 sitemap 状态')
    expect(submit?.ok).toBe(false)
    // 不能因为提交失败就谎报成功
    expect(confirm?.ok).toBe(false)
  })

  it('回读状态携带错误与警告数，便于发现 sitemap 问题', async () => {
    const client = fakeClient({
      '/token': { token: 'googleabc.html' },
      '/sitemaps/': { lastDownloaded: '2026-08-06', warnings: '3', errors: '1' },
    })
    const dir = mkdtempSync(join(tmpdir(), 'gsc-'))
    const results = await runGscAutomation({
      client,
      siteUrl: SITE,
      sitemapUrl: SITEMAP,
      outDir: dir,
    })
    const confirm = results.find((r) => r.step === '确认 sitemap 状态')
    expect(confirm?.detail).toContain('错误 1')
    expect(confirm?.detail).toContain('警告 3')
  })

  it('取令牌失败时立即返回，不做无意义的后续调用', async () => {
    const client = fakeClient({}, ['/token'])
    const dir = mkdtempSync(join(tmpdir(), 'gsc-'))
    const results = await runGscAutomation({
      client,
      siteUrl: SITE,
      sitemapUrl: SITEMAP,
      outDir: dir,
    })
    expect(results).toHaveLength(1)
    expect(results[0].ok).toBe(false)
  })
})
