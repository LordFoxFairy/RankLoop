import * as cheerio from 'cheerio'
import matter from 'gray-matter'
import { marked } from 'marked'
import type { SeoDocument } from './types'

/**
 * 把托管内容解析成规则引擎的输入。
 *
 * ADR-001 §3：Markdown 的元数据由 frontmatter 提供。因为平台负责渲染，
 * <head> 由平台生成，所以 MD 与 HTML 都能跑全量规则。
 * 缺失的元数据按「缺失」处理，而非按「无法判定」跳过——
 * 对托管内容而言，frontmatter 没写 title 就是真的没有 title。
 */

export interface ParseInput {
  format: 'html' | 'markdown'
  body: string
  /** 页面最终 URL，用于 canonical 同域判定 */
  url: string
}

export interface ParsedContent {
  doc: SeoDocument
  /** 从 frontmatter 或 HTML head 提取的元数据，供存库 */
  metadata: Record<string, unknown>
  /** Markdown 渲染出的 HTML，供投递使用 */
  renderedHtml?: string
}

function isInternal(href: string, pageUrl: string): boolean {
  if (href.startsWith('#')) return false
  try {
    return new URL(href, pageUrl).host === new URL(pageUrl).host
  } catch {
    return false
  }
}

/** 从 cheerio 文档提取正文结构，HTML 与渲染后的 MD 共用 */
function extractBody($: cheerio.CheerioAPI, pageUrl: string): SeoDocument['body'] {
  const headings: SeoDocument['body']['headings'] = []
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    headings.push({
      level: Number(el.tagName.slice(1)),
      text: $(el).text().trim(),
    })
  })

  const images: SeoDocument['body']['images'] = []
  $('img').each((_, el) => {
    const src = $(el).attr('src')
    if (src) images.push({ src, alt: $(el).attr('alt') })
  })

  const links: SeoDocument['body']['links'] = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (href) {
      links.push({ href, internal: isInternal(href, pageUrl), text: $(el).text().trim() })
    }
  })

  return { headings, images, links, text: $.root().text().replace(/\s+/g, ' ').trim() }
}

function parseHtml(body: string, url: string): ParsedContent {
  const $ = cheerio.load(body)

  const openGraph: Record<string, string> = {}
  $('meta[property^="og:"]').each((_, el) => {
    const prop = $(el).attr('property')?.slice(3)
    const content = $(el).attr('content')
    if (prop && content) openGraph[prop] = content
  })

  const jsonLd: string[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    jsonLd.push($(el).html() ?? '')
  })

  const head: SeoDocument['head'] = {
    title: $('title').first().text().trim() || undefined,
    description: $('meta[name="description"]').attr('content')?.trim() || undefined,
    canonical: $('link[rel="canonical"]').attr('href')?.trim() || undefined,
    robots: $('meta[name="robots"]').attr('content')?.trim() || undefined,
    lang: $('html').attr('lang')?.trim() || undefined,
    openGraph,
  }

  // 正文结构只看 body，避免 head 内的文本混入正文长度统计
  const $body = cheerio.load($('body').html() ?? body)

  return {
    doc: { url, head, body: extractBody($body, url), jsonLd, statusCode: 200 },
    metadata: { ...head },
  }
}

function parseMarkdown(body: string, url: string): ParsedContent {
  const { data: frontmatter, content } = matter(body)
  const html = marked.parse(content, { async: false }) as string
  const $ = cheerio.load(html)

  const fm = frontmatter as Record<string, unknown>
  const str = (v: unknown): string | undefined => {
    const s = typeof v === 'string' ? v.trim() : undefined
    return s || undefined
  }

  const og = (fm.openGraph ?? fm.og) as Record<string, string> | undefined

  const head: SeoDocument['head'] = {
    title: str(fm.title),
    description: str(fm.description),
    canonical: str(fm.canonical),
    robots: str(fm.robots),
    lang: str(fm.lang) ?? str(fm.language),
    openGraph: og ?? {},
  }

  const jsonLd = Array.isArray(fm.jsonLd) ? fm.jsonLd.map((x) => JSON.stringify(x)) : []

  return {
    doc: { url, head, body: extractBody($, url), jsonLd, statusCode: 200 },
    metadata: { ...head, frontmatter: fm },
    renderedHtml: html,
  }
}

export function parseContent({ format, body, url }: ParseInput): ParsedContent {
  return format === 'markdown' ? parseMarkdown(body, url) : parseHtml(body, url)
}
