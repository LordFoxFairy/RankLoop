---
title: RankLoop SEO — 内容发布前自动做 SEO 体检
description: RankLoop 在内容发布前自动执行 24 条 SEO 规则检测，存在严重问题的内容无法发布，并自动生成 sitemap 提交给搜索引擎。
canonical: https://lordfoxfairy.github.io/RankLoop/
lang: zh-CN
og:
  title: RankLoop SEO
  description: 发布前自动 SEO 体检
  image: https://lordfoxfairy.github.io/RankLoop/og.png
---

# RankLoop SEO

RankLoop 是一个 SEO 全生命周期管理平台。内容在发布之前会自动经过 24 条 SEO 规则检测，
存在严重问题的内容会被直接拦截，无法进入线上站点。

## 它解决什么问题

大多数网站的 SEO 问题都是在发布之后才被发现的：标题缺失、描述重复、canonical 指向错误、
页面被 noindex 屏蔽。等到从搜索控制台看到流量下滑时，损失已经造成。

RankLoop 把检测提前到发布之前。规则不通过，内容就发不出去。

## 工作方式

提交内容后，平台会立即返回检测结果，其中包含具体的规则编码、触发证据以及明确的修复建议。
第三方系统可以据此自动修改内容并重新提交，直到全部规则通过为止。

通过之后，页面会被构建进静态站点，并自动写入 sitemap 提交给搜索引擎。

## 更多内容

阅读[快速开始指南](/getting-started)了解如何接入，或查看[规则清单](/rules)了解全部检测项。
