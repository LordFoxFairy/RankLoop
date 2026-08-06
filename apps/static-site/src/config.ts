import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 站点配置。
 *
 * 从仓库根目录的 rankloop.config.json 读取，让站点外观、导航、首页布局
 * 都能不改代码地自定义——这是「快速自定义」的基础。
 * 环境变量优先于配置文件，便于同一份内容部署到不同域名。
 */

export interface NavItem {
  label: string
  href: string
}

export interface HomeHero {
  /** 首页大标题，留空则使用 index.md 的 H1 */
  title?: string
  subtitle?: string
  /** 行动按钮 */
  actions?: Array<{ label: string; href: string; primary?: boolean }>
}

export interface ThemeConfig {
  /** 主色，用于链接与强调 */
  accent?: string
  /** 正文字体族 */
  fontFamily?: string
  /** 内容区最大宽度 */
  contentWidth?: string
  /** 深色模式：auto 跟随系统，light/dark 强制 */
  colorScheme?: 'auto' | 'light' | 'dark'
}

export interface SiteConfig {
  siteName: string
  siteUrl: string
  /** 站点描述，用于首页未提供 description 时兜底 */
  description?: string
  lang: string
  nav: NavItem[]
  home?: HomeHero
  theme: ThemeConfig
  /** 页脚 HTML，支持简单标签 */
  footer?: string
  /** 默认社交分享图 */
  defaultOgImage?: string
  /** 注入到所有页面 head 的自定义标签（如统计代码） */
  headExtra?: string
}

const DEFAULTS: SiteConfig = {
  siteName: 'RankLoop Site',
  siteUrl: 'http://localhost:4173',
  lang: 'zh-CN',
  nav: [],
  theme: {
    accent: '#0b62d0',
    fontFamily: 'system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
    contentWidth: '760px',
    colorScheme: 'auto',
  },
}

/** 主机名转小写；URL 非法时原样返回，交由后续步骤报错 */
function normalizeHost(url: string): string {
  try {
    const u = new URL(url)
    u.hostname = u.hostname.toLowerCase()
    return u.toString().replace(/\/$/, '')
  } catch {
    return url
  }
}

export function loadConfig(rootDir = process.cwd()): SiteConfig {
  const file = join(rootDir, 'rankloop.config.json')
  let fromFile: Partial<SiteConfig> = {}

  if (existsSync(file)) {
    try {
      fromFile = JSON.parse(readFileSync(file, 'utf8')) as Partial<SiteConfig>
    } catch (e) {
      throw new Error(`rankloop.config.json 解析失败：${(e as Error).message}`)
    }
  }

  // 环境变量优先：同一份配置可部署到不同域名，无需改文件
  const rawUrl = (process.env.SITE_URL ?? fromFile.siteUrl ?? DEFAULTS.siteUrl).replace(/\/$/, '')
  // 主机名转小写：DNS 不区分大小写，但 Google 会把 Example.com 与 example.com
  // 当作两个 URL，造成重复内容。路径保持原样（路径是大小写敏感的）。
  const siteUrl = normalizeHost(rawUrl)

  return {
    ...DEFAULTS,
    ...fromFile,
    siteName: process.env.SITE_NAME ?? fromFile.siteName ?? DEFAULTS.siteName,
    siteUrl,
    lang: fromFile.lang ?? DEFAULTS.lang,
    nav: fromFile.nav ?? DEFAULTS.nav,
    theme: { ...DEFAULTS.theme, ...(fromFile.theme ?? {}) },
    defaultOgImage:
      process.env.OG_IMAGE ?? fromFile.defaultOgImage ?? `${siteUrl}/og.png`,
  }
}
