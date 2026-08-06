import { describe, expect, it } from 'vitest'
import type { SiteConfig } from './config'
import { renderPage } from './theme'

const BASE: SiteConfig = {
  siteName: '测试站点',
  siteUrl: 'https://example.com',
  lang: 'zh-CN',
  nav: [
    { label: '首页', href: '/' },
    { label: '文档', href: '/docs' },
    { label: 'GitHub', href: 'https://github.com/x/y' },
  ],
  theme: { accent: '#ff0000', fontFamily: 'serif', contentWidth: '900px', colorScheme: 'auto' },
}

function render(overrides: Partial<Parameters<typeof renderPage>[0]> = {}) {
  return renderPage({
    config: BASE,
    basePath: '',
    title: '页面标题',
    description: '页面描述',
    canonical: 'https://example.com/p',
    lang: 'zh-CN',
    og: {},
    jsonLd: '',
    body: '<h1>正文标题</h1><p>正文</p>',
    isHome: false,
    ...overrides,
  })
}

describe('配置驱动的外观', () => {
  it('主色应用到 CSS 变量', () => {
    expect(render()).toContain('--accent:#ff0000')
  })

  it('内容宽度可配置', () => {
    expect(render()).toContain('--width:900px')
  })

  it('字体族可配置', () => {
    expect(render()).toContain('font:16px/1.75 serif')
  })

  it('强制浅色时不输出深色媒体查询', () => {
    const html = renderPage({
      config: { ...BASE, theme: { ...BASE.theme, colorScheme: 'light' } },
      basePath: '',
      title: 't',
      description: 'd',
      canonical: 'https://example.com/p',
      lang: 'zh-CN',
      og: {},
      jsonLd: '',
      body: '',
      isHome: false,
    })
    expect(html).toContain('color-scheme:light;')
    expect(html).not.toContain('prefers-color-scheme:dark')
  })
})

describe('导航', () => {
  it('渲染配置中的全部导航项', () => {
    const html = render()
    expect(html).toContain('>首页<')
    expect(html).toContain('>文档<')
    expect(html).toContain('>GitHub<')
  })

  it('站内链接带 base path，外链保持原样', () => {
    const html = render({ basePath: '/repo' })
    expect(html).toContain('href="/repo/docs"')
    expect(html).toContain('href="https://github.com/x/y"')
    expect(html).not.toContain('/repo/https')
  })

  it('无导航配置时不输出空 nav 标签', () => {
    const html = renderPage({
      config: { ...BASE, nav: [] },
      basePath: '',
      title: 't',
      description: 'd',
      canonical: 'https://example.com/p',
      lang: 'zh-CN',
      og: {},
      jsonLd: '',
      body: '',
      isHome: false,
    })
    expect(html).not.toContain('<nav>')
  })
})

describe('首页 hero', () => {
  const withHero: SiteConfig = {
    ...BASE,
    home: {
      title: '首页大标题',
      subtitle: '副标题说明',
      actions: [
        { label: '开始', href: '/start', primary: true },
        { label: '文档', href: '/docs' },
      ],
    },
  }

  it('首页渲染 hero 区与行动按钮', () => {
    const html = renderPage({
      config: withHero,
      basePath: '',
      title: 't',
      description: 'd',
      canonical: 'https://example.com/',
      lang: 'zh-CN',
      og: {},
      jsonLd: '',
      body: '<h1>正文标题</h1>',
      isHome: true,
    })
    expect(html).toContain('首页大标题')
    expect(html).toContain('副标题说明')
    expect(html).toContain('class="primary"')
  })

  // 两个 H1 会稀释页面主题，且与本项目自己的 MULTIPLE_H1 规则冲突
  it('启用 hero 时正文 H1 降级为 H2，全页只保留一个 H1', () => {
    const html = renderPage({
      config: withHero,
      basePath: '',
      title: 't',
      description: 'd',
      canonical: 'https://example.com/',
      lang: 'zh-CN',
      og: {},
      jsonLd: '',
      body: '<h1>正文标题</h1><p>x</p>',
      isHome: true,
    })
    expect((html.match(/<h1[^>]*>/g) ?? []).length).toBe(1)
    expect(html).toContain('<h2>正文标题</h2>')
  })

  it('内页不渲染 hero，正文 H1 保持不变', () => {
    const html = renderPage({
      config: withHero,
      basePath: '',
      title: 't',
      description: 'd',
      canonical: 'https://example.com/p',
      lang: 'zh-CN',
      og: {},
      jsonLd: '',
      body: '<h1>正文标题</h1>',
      isHome: false,
    })
    expect(html).not.toContain('首页大标题')
    expect(html).toContain('<h1>正文标题</h1>')
  })

  it('未配置 hero 时首页保留正文 H1', () => {
    const html = render({ isHome: true })
    expect(html).toContain('<h1>正文标题</h1>')
  })
})

describe('SEO 标签', () => {
  it('首页 og:type 为 website，内页为 article', () => {
    expect(render({ isHome: true })).toContain('content="website"')
    expect(render({ isHome: false })).toContain('content="article"')
  })

  it('输出 og:site_name', () => {
    expect(render()).toContain('content="测试站点"')
  })

  it('转义标题中的 HTML，防止注入', () => {
    const html = render({ title: '标题<script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('自定义扩展', () => {
  it('headExtra 注入到 head（用于统计代码等）', () => {
    const html = renderPage({
      config: { ...BASE, headExtra: '<meta name="custom" content="v">' },
      basePath: '',
      title: 't',
      description: 'd',
      canonical: 'https://example.com/p',
      lang: 'zh-CN',
      og: {},
      jsonLd: '',
      body: '',
      isHome: false,
    })
    expect(html).toContain('<meta name="custom" content="v">')
  })

  it('自定义页脚生效', () => {
    const html = renderPage({
      config: { ...BASE, footer: '自定义页脚内容' },
      basePath: '',
      title: 't',
      description: 'd',
      canonical: 'https://example.com/p',
      lang: 'zh-CN',
      og: {},
      jsonLd: '',
      body: '',
      isHome: false,
    })
    expect(html).toContain('自定义页脚内容')
  })
})
