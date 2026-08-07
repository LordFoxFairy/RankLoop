import type { Rule } from './types'

/**
 * 扩展规则集：对齐主流 SEO 工具（Yoast / RankMath / Screaming Frog）的常见检查项。
 *
 * 与基础规则集同样遵守：信息不足时跳过而非误报；每条都给出证据与修复建议。
 */

const DESCRIPTION_MAX = 160
const TITLE_KEYWORD_MIN_OVERLAP = 0.2
const MAX_URL_LENGTH = 100
const MIN_WORD_COUNT = 300
const MAX_HEADING_JUMP = 1

/** 粗略切词：中文按字、西文按空格，仅用于长度量级判断 */
function wordCount(text: string): number {
  const cjk = (text.match(/[一-龥]/g) ?? []).length
  const latin = text.replace(/[一-龥]/g, ' ').split(/\s+/).filter(Boolean).length
  return cjk + latin
}

/**
 * 切词。
 *
 * 中文没有空格分隔，按空格切会把整句当成一个词，导致两个高度相似的标题
 * 重合度为 0。因此 CJK 按单字切分，西文按空格切分。
 */
function tokenize(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')
  const tokens = new Set<string>()

  for (const ch of normalized.match(/[一-龥]/g) ?? []) tokens.add(ch)

  for (const word of normalized.replace(/[一-龥]/g, ' ').split(/\s+/)) {
    if (word.length > 1) tokens.add(word)
  }

  return tokens
}

export const extendedRules: Rule[] = [
  {
    code: 'DESCRIPTION_TOO_LONG',
    severity: 'warning',
    weight: 8,
    evaluate(doc) {
      const desc = doc.head.description?.trim()
      if (!desc || desc.length <= DESCRIPTION_MAX) return null
      return {
        message: '描述过长，搜索结果中会被截断',
        evidence: `描述长度 ${desc.length} 字符，建议不超过 ${DESCRIPTION_MAX}`,
        recommendation: `压缩到 ${DESCRIPTION_MAX} 字符以内，把关键信息前置。`,
      }
    },
  },
  {
    code: 'THIN_CONTENT',
    severity: 'warning',
    weight: 12,
    evaluate(doc) {
      const words = wordCount(doc.body.text)
      // 正文极短的情况由 EMPTY_CONTENT 处理，此处只管「有内容但偏薄」
      if (words === 0 || words >= MIN_WORD_COUNT) return null
      return {
        message: '内容偏薄，竞争力不足',
        evidence: `正文约 ${words} 词/字，建议不少于 ${MIN_WORD_COUNT}`,
        recommendation: `扩充到 ${MIN_WORD_COUNT} 词以上，覆盖用户搜索意图的完整答案。`,
      }
    },
  },
  {
    code: 'TITLE_H1_MISMATCH',
    severity: 'notice',
    weight: 3,
    evaluate(doc) {
      const title = doc.head.title?.trim()
      const h1 = doc.body.headings.find((h) => h.level === 1)?.text.trim()
      if (!title || !h1) {
        return { code: 'TITLE_H1_MISMATCH', reason: '缺少 title 或 H1，无法比对相关性' }
      }
      const a = tokenize(title)
      const b = tokenize(h1)
      if (a.size === 0 || b.size === 0) {
        return { code: 'TITLE_H1_MISMATCH', reason: '标题分词为空，无法比对' }
      }
      const overlap = [...a].filter((t) => b.has(t)).length / Math.min(a.size, b.size)
      if (overlap >= TITLE_KEYWORD_MIN_OVERLAP) return null
      return {
        message: '标题与 H1 主题不一致，可能稀释关键词信号',
        evidence: `title「${title}」与 H1「${h1}」词汇重合度约 ${Math.round(overlap * 100)}%`,
        recommendation: '让 title 与 H1 表达同一主题，共享核心关键词。',
      }
    },
  },
  {
    code: 'HEADING_HIERARCHY_SKIP',
    severity: 'notice',
    weight: 3,
    evaluate(doc) {
      const levels = doc.body.headings.map((h) => h.level)
      if (levels.length < 2) return null
      for (let i = 1; i < levels.length; i++) {
        const jump = levels[i] - levels[i - 1]
        if (jump > MAX_HEADING_JUMP) {
          return {
            message: '标题层级跳跃，文档结构不清晰',
            evidence: `H${levels[i - 1]} 之后直接出现 H${levels[i]}`,
            recommendation: '逐级使用标题，不要跳过中间层级。',
          }
        }
      }
      return null
    },
  },
  {
    code: 'URL_TOO_LONG',
    severity: 'notice',
    weight: 2,
    evaluate(doc) {
      try {
        const path = new URL(doc.url).pathname
        if (path.length <= MAX_URL_LENGTH) return null
        return {
          message: 'URL 路径过长，不利于分享与展示',
          evidence: `路径长度 ${path.length} 字符`,
          recommendation: `缩短到 ${MAX_URL_LENGTH} 字符以内，保留核心关键词。`,
        }
      } catch {
        return { code: 'URL_TOO_LONG', reason: 'URL 非法，无法判定长度' }
      }
    },
  },
  {
    code: 'NON_DESCRIPTIVE_LINK_TEXT',
    severity: 'notice',
    weight: 2,
    evaluate(doc) {
      const withText = doc.body.links.filter((l) => l.text !== undefined)
      if (withText.length === 0) {
        return { code: 'NON_DESCRIPTIVE_LINK_TEXT', reason: '解析结果未包含链接文本，无法判定' }
      }
      // 这类锚文本不传递任何主题信号，搜索引擎与屏幕阅读器都无法理解目标
      const vague = /^(点击这里|查看更多|更多|详情|这里|阅读全文|click here|read more|here|more|link)$/i
      const bad = withText.filter((l) => l.text && vague.test(l.text))
      if (bad.length === 0) return null
      return {
        message: '存在无描述性的锚文本，无法传递主题信号',
        evidence: `${bad.length} 处：${bad.map((l) => `「${l.text}」`).join('、')}`,
        recommendation: '把锚文本改成目标页面的主题描述，如「SEO 优化指南」。',
      }
    },
  },
  {
    code: 'MISSING_OG_IMAGE',
    severity: 'notice',
    weight: 2,
    evaluate(doc) {
      const og = doc.head.openGraph ?? {}
      if (og.image) return null
      return {
        message: '缺少 og:image，社交分享无缩略图',
        evidence: 'og:image 未设置',
        recommendation: '添加 og:image，建议 1200×630，提升分享点击率。',
      }
    },
  },
  {
    code: 'IMAGE_ALT_TOO_LONG',
    severity: 'notice',
    weight: 2,
    evaluate(doc) {
      const tooLong = doc.body.images.filter((i) => (i.alt?.length ?? 0) > 125)
      if (tooLong.length === 0) return null
      return {
        message: 'alt 文本过长，屏幕阅读器体验差',
        evidence: `${tooLong.length} 张图片 alt 超过 125 字符`,
        recommendation: '把 alt 压缩到 125 字符内，简明描述图片内容。',
      }
    },
  },
  {
    /**
     * 结构化数据缺失。
     *
     * INVALID_JSON_LD 只在「有 JSON-LD 但语法错」时触发，
     * 一个字都没写的页面反而静默通过。但结构化数据决定能否拿到
     * 富媒体摘要——同样排名下，带摘要的结果点击率明显更高，
     * 这是少数能真正影响流量、且完全由内容方控制的技术项。
     *
     * 定为 notice：没有它页面照样收录，只是拿不到富媒体展示。
     */
    code: 'MISSING_STRUCTURED_DATA',
    severity: 'notice',
    weight: 3,
    evaluate(doc) {
      if (doc.jsonLd && doc.jsonLd.length > 0) return null
      return {
        message: '页面没有结构化数据，无法获得富媒体摘要',
        evidence: '未找到任何 JSON-LD 片段',
        recommendation:
          '添加 schema.org 结构化数据（文章用 Article，产品用 Product），' +
          '可用 Google 富媒体测试工具校验。',
      }
    },
  },
  {
    /**
     * 标题未包含正文主题词。
     *
     * Google 判断相关性的第一依据就是标题。标题写得再漂亮，
     * 如果和正文讲的不是一回事，就匹配不上用户的搜索词——
     * 这是「内容明明不错却排不上去」最常见的原因之一。
     *
     * 用 H1 与正文开头做交叉验证，而非猜关键词：
     * 平台不做关键词研究，只检查内部一致性。
     *
     * 阈值取得很低（10%）：标题用同义词而非原词复述是正常写法，
     * 阈值定高会把好内容误判成标题党。宁可漏报也不误报（§0 第 10 条）。
     */
    code: 'TITLE_TOPIC_MISMATCH',
    severity: 'notice',
    weight: 3,
    evaluate(doc) {
      const title = doc.head.title?.trim()
      const h1 = doc.body.headings.find((h) => h.level === 1)?.text?.trim()
      if (!title || !h1) return null

      // 复用文件顶部的 tokenize（中文按字、西文按词）——
      // 另写一套会让两条标题规则的判定口径悄悄分叉
      const titleTokens = tokenize(title)
      if (titleTokens.size === 0) return null
      // 只取正文前 300 字：主题词应当在开头出现，埋在末尾说明结构有问题
      const bodyTokens = tokenize(doc.body.text.slice(0, 300))
      if (bodyTokens.size === 0) return null

      // 正文过短时不判定：样本太小，比例没有意义
      if (doc.body.text.length < 200) {
        return { code: 'TITLE_TOPIC_MISMATCH', reason: '正文过短，无法判定主题一致性' }
      }

      const shared = [...titleTokens].filter((t) => bodyTokens.has(t))
      const ratio = shared.length / titleTokens.size
      // 完全无重合才提示：同义复述是正常写法，不能因此报警
      if (ratio > 0.1) return null

      return {
        message: '标题与正文开头主题不一致，影响搜索相关性判定',
        evidence: `标题中仅 ${Math.round(ratio * 100)}% 的词出现在正文开头`,
        recommendation:
          '让标题准确概括正文，并在开头段落自然出现标题中的核心词，' +
          '避免标题党式的表述。',
      }
    },
  },
  {
    /**
     * 缺少出站引用。
     *
     * 引用权威来源是 E-E-A-T 的可见信号之一：Google 用它判断
     * 内容是否有事实依据。一篇长文一个外链都没有，
     * 往往意味着内容是凭空写的。
     *
     * 只对长文要求——短页面（如落地页）本来就不需要引用。
     */
    code: 'NO_EXTERNAL_REFERENCES',
    severity: 'notice',
    weight: 3,
    evaluate(doc) {
      // 短内容不适用：落地页、目录页没有引用是正常的
      if (doc.body.text.length < 800) return null
      const external = doc.body.links.filter((l) => !l.internal)
      if (external.length > 0) return null

      return {
        message: '长文没有任何外部引用，缺少可信度信号',
        evidence: `正文 ${doc.body.text.length} 字符，外链 0 个`,
        recommendation:
          '引用权威来源（官方文档、研究报告、行业标准）并链接过去，' +
          '这是 Google 判断内容可信度的信号之一。',
      }
    },
  },
]
