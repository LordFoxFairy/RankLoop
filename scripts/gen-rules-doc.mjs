#!/usr/bin/env node
/**
 * 从规则引擎生成规则清单文档。
 *
 * 手写这份文档会脱节——本次就发现文档还写着 24 条，实际已有 29 条，
 * 新增的 5 条规则一条都没记录。让文档从代码生成，加规则时自动同步。
 *
 *   node scripts/gen-rules-doc.mjs
 */

import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { listRules, effortMinutes } = require('../packages/seo-rules/dist/engine.js')

const SEVERITY = {
  critical: { label: '严重', desc: '阻止发布。存在任意一条，内容都无法上线。' },
  warning: { label: '警告', desc: '不阻止发布，但会明显影响收录效果或点击率。' },
  notice: { label: '建议', desc: '锦上添花，修复后可进一步提升表现。' },
}

/** 规则说明：为什么这条重要，而非重复规则名 */
const WHY = {
  SERVER_ERROR: '页面返回错误状态码时搜索引擎无法抓取，也就谈不上收录与排名。',
  NOINDEX_DETECTED: 'noindex 是明确告诉搜索引擎「不要收录这一页」，通常是误留的调试标记。',
  MISSING_TITLE: '标题是搜索结果里最显眼的部分，缺失会导致几乎没有点击。',
  EMPTY_CONTENT: '没有实质内容的页面不会被索引。',
  CANONICAL_CROSS_DOMAIN: 'canonical 指向其他域名等于把本页权重转让出去。',
  THIN_CONTENT: '内容单薄难以覆盖用户的完整搜索意图，竞争力弱。',
  TITLE_TOO_LONG: '过长的标题在搜索结果中会被截断，关键信息看不到。',
  TITLE_TOO_SHORT: '标题过短无法充分表达页面主题。',
  MISSING_DESCRIPTION: '没有描述时摘要由搜索引擎自行截取，往往词不达意，拉低点击率。',
  MISSING_H1: 'H1 是页面主题的主要信号。',
  MULTIPLE_H1: '多个 H1 会稀释主题，搜索引擎难以判断页面重点。',
  MISSING_CANONICAL: '缺少 canonical 时，同一内容的多个 URL 会互相分散权重。',
  IMAGE_MISSING_ALT: 'alt 既是无障碍需求，也是图片搜索流量的唯一来源。',
  INVALID_JSON_LD: '结构化数据语法错误会被直接忽略，等于没写。',
  DESCRIPTION_TOO_LONG: '过长的描述在搜索结果中会被截断。',
  KEYWORD_STUFFING: '关键词堆砌被 Google 列为垃圾内容手法，可能导致降权——比排不上去更糟。',
  TITLE_TOPIC_MISMATCH: '标题与正文讲的不是一回事时，匹配不上用户的搜索词。',
  FEW_INTERNAL_LINKS: '内链是搜索引擎发现新页面与传递权重的主要途径。',
  MISSING_LANG: '语言声明帮助搜索引擎把内容投放给正确的用户群。',
  MISSING_OPEN_GRAPH: '影响社交平台分享时的展示效果。',
  MISSING_STRUCTURED_DATA: '结构化数据决定能否拿到富媒体摘要——同样排名下带摘要的点击率更高。',
  NO_EXTERNAL_REFERENCES: '引用权威来源是内容可信度的信号之一。',
  HEADING_HIERARCHY_SKIP: '标题层级跳跃会让文档结构难以解析。',
  URL_TOO_LONG: '过长的 URL 不利于分享与展示。',
  NON_DESCRIPTIVE_LINK_TEXT: '「点击这里」这类锚文本不传递任何主题信号。',
  MISSING_OG_IMAGE: '社交分享无缩略图会明显降低点击意愿。',
  IMAGE_ALT_TOO_LONG: '过长的 alt 影响屏幕阅读器体验。',
  TOO_MANY_LINKS: '链接过多会稀释每条链接分到的权重。',
  MULTIPLE_CANONICAL: '多个 canonical 相互冲突时搜索引擎可能全部忽略。',
}

const rules = listRules()
const byLevel = { critical: [], warning: [], notice: [] }
for (const r of rules) byLevel[r.severity]?.push(r)
for (const level of Object.keys(byLevel)) byLevel[level].sort((a, b) => b.weight - a.weight)

const totalMinutes = rules.reduce((s, r) => s + effortMinutes(r.code), 0)

const sections = Object.entries(SEVERITY)
  .map(([level, meta]) => {
    const list = byLevel[level]
    if (list.length === 0) return ''
    const rows = list
      .map((r) => {
        const mins = effortMinutes(r.code)
        const why = WHY[r.code] ?? ''
        return `### ${r.code}\n\n${why}\n\n扣分 ${r.weight} · 预估修复 ${mins} 分钟\n`
      })
      .join('\n')
    return `## ${meta.label}（${list.length} 条）\n\n${meta.desc}\n\n${rows}`
  })
  .join('\n')

const doc = `---
title: SEO 规则清单 — RankLoop 的 ${rules.length} 条检测规则说明
description: 完整列出 RankLoop 的 ${rules.length} 条 SEO 检测规则，按严重、警告、建议三级分类，说明每条规则为什么重要、扣多少分、修复大约需要多久。
lang: zh-CN
og:
  title: SEO 规则清单
  description: ${rules.length} 条检测规则的判定依据与修复成本
---

# SEO 规则清单

RankLoop 目前包含 ${rules.length} 条检测规则，分为三个级别。
只有**严重**级别会阻止内容发布——其余问题不影响上线，但会影响效果。

每条规则都给出扣分值与预估修复耗时，因此可以按「性价比」排序：
优先做花时间少、挽回分数多的。全部修完约需 ${Math.round(totalMinutes / 60 * 10) / 10} 小时。

评分从 100 分开始，按命中规则的权重扣减。分数高不代表可以发布——
只要有一条严重问题，无论多少分都会被拦住。

${sections}
## 判定原则

信息不足时**跳过而非报错**。例如无法解析链接文本时，
不会误报「锚文本无描述性」——宁可漏报也不误报，
否则用户会因为一堆假问题而不再信任检测结果。

检测依据来自 [Google 搜索基础规范](https://developers.google.com/search/docs/essentials)
与 [schema.org](https://schema.org/) 结构化数据标准。

规则清单也可通过接口获取：\`GET /api/v1/rules\`。
`

writeFileSync('content/rules.md', doc)
console.log(`已生成 content/rules.md：${rules.length} 条规则`)
console.log(
  `  严重 ${byLevel.critical.length} · 警告 ${byLevel.warning.length} · 建议 ${byLevel.notice.length}`,
)
