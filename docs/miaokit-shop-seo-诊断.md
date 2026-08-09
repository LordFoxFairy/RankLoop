# miaokit.cloud / shop.miaokit.cloud SEO 诊断

> **2026-08-09 第三次复测**：shop 全部修复完成，三个页面均 95 分以上。
> 主站补上了 H1 与 canonical，但正文变薄需要补内容。详见下方「最新状态」。

---

## 最新状态（第三次复测）

| 页面 | 首测 | 二测 | **三测** | 状态 |
|---|---|---|---|---|
| shop 首页 | 51 | 51 | **95 / 100** | ✅ 已修复 |
| shop 商品页 `/p/` | 不存在 | 98 | **98 / 100** | ✅ |
| shop 分类页 `/c/` | 不存在 | — | **98 / 100** | ✅ |
| shop sitemap | 1 条 | 259 条 | **259 条** | ✅ |
| 主站 miaokit.cloud | 31 ❌ | 85 | **83 / 100** | ⚠️ 内容偏薄 |

### shop：三条建议全部落实

```
title    : AI 工具与数字权益商品目录 — ChatGPT Plus、Claude、Gemini | miaokit   ✅
canonical: https://shop.miaokit.cloud/                                          ✅
h1       : AI 工具与数字权益商品目录        ← 已移出 <noscript>                  ✅
#app     : 已服务端渲染，不再是空壳                                              ✅
```

shop 现在**只剩一个 notice**：缺 `og:image`（分享到微信/Twitter 无缩略图）。
不影响收录，属锦上添花。

### 主站：修好两项，新出现一项

**已修复：** 补上了 `<h1>` 与 `canonical`（原先缺的两个 warning 已消除）。

**新问题：** HTML 从 3829B 缩到 2932B，正文仅 **582 字**，触发 `THIN_CONTENT`「内容偏薄」。
另外**站内链接 0 条** —— 门户的作用是把流量分发到各子站，没有站内链接则权重传不下去。

两条建议：

1. **正文补到 800 字以上** —— 写清 miaokit 是什么、各服务分别解决什么问题、适合谁用
2. **加站内链接** —— 门户应链向 shop、convert、api 等各子站

### 从最初到现在

| | 首测 | 现在 |
|---|---|---|
| shop 商品页 | **不存在**（所有路径返回同一份 HTML） | **215 个独立页**，98 分 |
| shop sitemap | 1 条 URL | **259 条** |
| shop 首页 | 51 分，纯客户端渲染 | **95 分**，服务端渲染 |
| 主站 | 31 分，critical 阻断发布 | **83 分**，可发布 |

**从「210 件商品 Google 只知道 1 个页面」到「259 个独立可收录页面」** ——
这是从「不可能有搜索流量」变成「有可能有」。

剩余项均无阻断性：og:image 是锦上添花，主站补字与加内链属内容层面工作。

---

## 历史记录

### 第二次复测

## 复测结果（2026-08-09 二次抓取）

| 页面 | 首次诊断 | 复测 | 状态 |
|---|---|---|---|
| shop 商品页 `/p/xxx/` | 不存在（所有路径同一份 HTML） | **98 / 100** | ✅ 已修复 |
| shop 分类页 `/c/xxx/` | 不存在 | 独立 title，含价格与在售数 | ✅ 已修复 |
| shop sitemap | 1 条 URL | **259 条**（215 商品 + 43 分类） | ✅ 已修复 |
| 主站 miaokit.cloud | 31 / 100（critical 阻断） | **85 / 100** | ✅ 已修复 |
| **shop 首页** | 51 / 100 | **51 / 100** | ⚠️ **被遗漏** |

### 已经修好的（三条第一优先做到了）

**1. 商品页有了独立 URL 与完整 meta**

```
/p/fsxw4m/   5887B
  <title>GPT Plus 1个月充值【官方卡充｜菲区｜质保掉订阅｜不可覆盖】— 库存 104 件 ¥140 | miaokit</title>
  <link rel="canonical" href="https://shop.miaokit.cloud/p/fsxw4m/">
  application/ld+json × 1
```

标题里带了库存与价格，canonical 指向自身，还有结构化数据。**98 分，只差一个 og:image。**

**2. sitemap 从 1 条变成 259 条**

```
215 条  /p/    商品页
 43 条  /c/    分类页
  1 条  /      首页
```

**3. 主站补上了正文与标题**

HTML 906B → 3829B，title 变成
「miaokit — ChatGPT Plus、Claude、Gemini 等 AI 工具与数字权益」，
原先的 `EMPTY_CONTENT`（critical，直接阻断发布）已消除。

### ⚠️ 唯一遗漏：shop 首页仍是纯客户端渲染

抓到的线上原文：

```html
<body>
  <div id="app"></div>                              <!-- 空的 -->
  <noscript><div>
    <h1>miaokit — ChatGPT Plus、Claude、Gemini…</h1>  <!-- 只在 JS 不可用时显示 -->
    <p>共 196 件在售，最低 ¥0.60。…</p>
```

`<noscript>` 是「JS 不可用时的降级内容」，不是正式内容。Google 渲染 JS 后看到的仍是空的 `#app`。
商品页与分类页都已改成服务端渲染，**唯独首页没改** —— 而首页通常是全站权重最高的页面。

首页当前扣分项：

| 规则 | 说明 |
|---|---|
| `MISSING_H1` | h1 只存在于 `<noscript>` 内 |
| `TITLE_TOO_SHORT` | 「商品目录」仅 4 字，无品牌词、无品类词 |
| `MISSING_DESCRIPTION` | 24 字，偏短 |
| `MISSING_CANONICAL` | 无 canonical |
| `MISSING_OPEN_GRAPH` / `MISSING_OG_IMAGE` | 分享无缩略图 |

### 还需要做的三件事

**shop 首页（51 → 90+）**

1. **改服务端渲染** —— 和 `/p/`、`/c/` 一样把内容直接渲染进 `<body>`，不要放在 `<noscript>` 里
2. **标题加长**
   ```
   商品目录
   → AI 工具与数字权益商品目录 — ChatGPT Plus、Claude、Gemini | miaokit
   ```
3. **补 canonical**
   ```html
   <link rel="canonical" href="https://shop.miaokit.cloud/">
   ```

**主站 miaokit.cloud（85 → 90+）**

4. 补一个 `<h1>`，内容与 title 呼应
5. 增加站内链接，门户应链向各子站

**两站共同（锦上添花）**

6. 加 `og:image`、`og:title`、`og:description` —— 分享到微信/Twitter 才有缩略图

---

## 首次诊断存档（2026-08-09 首测）

诊断时间：2026-08-09
方法：抓取线上真实 HTML，用 RankLoop 的 30 条规则实测评分

---

## 一句话结论

| 站点 | 健康分 | 能否通过发布门槛 | 最致命的问题 |
|---|---|---|---|
| **miaokit.cloud** | **31 / 100** | ❌ **被阻断** | 正文仅 50 字，被判定为空页面 |
| **shop.miaokit.cloud** | **51 / 100** | ✅ 勉强通过 | 210 件商品只有 1 个可收录 URL |

两个站都**没有配 SEO**。shop 比主站好，是因为最近已改成服务端渲染。

---

## 一、shop.miaokit.cloud

### 已经解决的（值得肯定）

对比 8 月 7 日的抓取，**已从纯 CSR 改成服务端渲染**：

| | 8/7 | 8/9 |
|---|---|---|
| HTML 大小 | 1004 B | **15380 B** |
| 爬虫可见正文 | 0 字 | **3072 字** |
| h1 | 无 | **1 个** |
| 结构化数据 | 0 | **1 个 ItemList** |

这解决了最大的问题——之前 Google 抓到的是空的 `<div id="app"></div>`。

### 🔴 致命问题：所有路径返回同一份 HTML

实测三个不同路径：

```
/                       15380B   <title>商品目录</title>
/product/test-anything  15380B   <title>商品目录</title>
/category/gpt           15380B   <title>商品目录</title>
```

**字节数完全相同，标题完全相同。**

**后果：** Google 判定为重复内容，210 件商品最多只收录 1 个页面。这是目录类站点的死穴——商品页收不进去，SEO 等于没做。

**修复：** 每个商品页要有独立 URL、独立 `<title>`、独立 `description`、独立正文。

```
/product/upi-pix-cdk
  <title>UPI/PIX 提链通用 CDK — 库存 601 件 | miaokit</title>
  <meta name="description" content="印度 UPI、巴西 PIX 通用提链卡密，当前库存 601 件，¥5.50 起。实时同步价格与库存。">
```

### 🔴 致命问题：sitemap 只有 1 条 URL

```xml
<urlset>
  <url><loc>https://shop.miaokit.cloud/</loc>...</url>
</urlset>
```

210 件商品，Google 只知道 1 个地址。

**修复：** sitemap 应包含所有商品页与分类页。商品有增删就重新生成。

### 🟡 其余问题（按修复性价比排序）

| 问题 | 影响 | 怎么修 |
|---|---|---|
| **缺 canonical** | 带 `?utm_source=` 等参数的地址会被当成不同页面，权重分散 | `<link rel="canonical" href="https://shop.miaokit.cloud/">` |
| **缺 H1** | 有 `<h1>` 标签但内容为空。H1 是主题最强信号 | `<h1>AI 工具与数字权益商品目录</h1>` |
| **标题过短** | 「商品目录」4 字，没有品牌词也没有品类词 | 「AI 工具与数字权益商品目录 — miaokit」 |
| **description 过短** | 当前 24 字，搜索结果摘要展示不充分 | 补到 80–150 字，写清品类、数量、更新频率 |
| **缺 og:image** | 分享到微信/Twitter 没有缩略图，点击率低 | 加 `og:image`、`og:title`、`og:description` |
| **内链偏少** | 55 个链接几乎全是站外购买链接，Google 靠链接爬行 | 商品页之间互链、加分类导航 |

### 结构化数据可以更进一步

现在有 `ItemList`（1 个），但**没有 `Product` / `Offer`**。

补上后，Google 搜索结果里能直接显示**价格、库存状态、评分**——这是电商类最值钱的富媒体摘要：

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "UPI/PIX 提链通用 CDK",
  "offers": {
    "@type": "Offer",
    "price": "5.50",
    "priceCurrency": "CNY",
    "availability": "https://schema.org/InStock"
  }
}
```

---

## 二、miaokit.cloud（主站门户）

### 🔴 被发布门槛阻断：正文仅 50 字

整页可见文字只有 50 字，规则判定「疑似空页面」。这是 **critical**，在 RankLoop 里会直接拦住发布。

**修复：** 门户页至少要有一段说明「miaokit 是什么、提供哪些服务、适合谁用」。现在只有几个入口卡片，没有任何介绍文字。

### 🔴 所有路径返回同一份 HTML

```
/           953B   <title>miaokit — AI 工具与数字权益</title>
/anything   953B   <title>miaokit — AI 工具与数字权益</title>
```

和 shop 同样的问题。门户页面少，影响没 shop 那么大，但 404 页面应该真的返回 404。

### 🟡 其余问题

| 问题 | 怎么修 |
|---|---|
| **完全没有 H1** | 加 `<h1>miaokit — AI 工具与数字权益</h1>` |
| **缺 canonical** | `<link rel="canonical" href="https://miaokit.cloud/">` |
| **缺 og:image / Open Graph** | 分享无缩略图 |
| **没有任何结构化数据** | 加 `Organization` + `WebSite`，让 Google 认识这个品牌 |
| **description 过短** | 当前 24 字，补到 80–150 字 |
| **内链偏少** | 门户就是分发入口，应该链向所有子站 |
| **sitemap 只有 1 条** | 门户页面本来就少，但至少把各入口页列上 |

---

## 三、修复优先级

### 第一优先（不做等于没做 SEO）

1. **shop：商品页独立 URL + 独立 title/description** — 210 件商品能被收录的前提
2. **shop：sitemap 列出所有商品页** — 让 Google 知道这些地址存在
3. **主站：补正文** — 现在是 critical，判定为空页面

### 第二优先（成本低、收益直接）

4. 两站都加 `canonical`（各一行）
5. 两站都补 `H1`（各一行）
6. 两站标题、description 写够长度

### 第三优先（锦上添花）

7. shop 加 `Product` / `Offer` 结构化数据 → 搜索结果显示价格库存
8. 主站加 `Organization` / `WebSite` 结构化数据
9. 两站加 og:image
10. 增加站内互链

---

## 四、要说清楚的话

**没有任何工具能保证排名或流量。** 上面这些做的是「消除技术层面的障碍」——让 Google 能抓到、能理解、能收录。至于排到第几，取决于内容质量、站点权威度和竞争程度，由 Google 决定。

Google 官方原话：*"Google doesn't guarantee that it will crawl, index, or serve your page."*

但**收录不了就一定没有流量**——上面第一优先的三条，是从「不可能有流量」变成「有可能有流量」的分界线。

---

## 五、验证方式

改完后可以用 RankLoop 自己复检：

```bash
curl -sS -L https://shop.miaokit.cloud/ -o page.html
python3 -c "
import json; print(json.dumps({
  'format':'html',
  'body':open('page.html',encoding='utf-8').read(),
  'url':'https://shop.miaokit.cloud/'}))" > req.json

curl -sS -X POST https://<你的租户域名>/api/v1/contents/check \
  -H 'Authorization: Bearer rkl_live_xxx' \
  -H 'content-type: application/json' --data @req.json
```

返回里 `publishable` 为 `true` 且 `score` ≥ 90 就算达标。
