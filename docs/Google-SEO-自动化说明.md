# Google SEO 自动化：能做什么，不能做什么

本文基于 Google 官方文档核实，说明"发布一条内容 → Google 收录并排名靠前"
这条链路中哪些环节可以自动化、哪些不能。

## 结论先行

**没有任何工具能让普通内容"发布即被 Google 收录"。** 声称能做到的都不实。

Google 官方原文（[Ask Google to recrawl](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)）：

> "Crawling can take anywhere from a few days to a few weeks."
>
> "Requesting a crawl does not guarantee that inclusion in search results
> will happen instantly or even at all."

## 各条路径的真实情况

### 1. Google Indexing API —— 普通内容不可用

官方文档（[Indexing API Quickstart](https://developers.google.com/search/apis/indexing-api/v3/quickstart)）明确限制：

> "can only be used to crawl pages with either `JobPosting` or
> `BroadcastEvent` embedded in a `VideoObject`."

| 内容类型 | 可用 |
| --- | --- |
| 招聘信息（JobPosting） | ✅ |
| 直播视频（BroadcastEvent） | ✅ |
| 文章、博客、产品页 | ❌ **协议不允许** |

默认配额仅 200，且需额外审批。

网上流传的"用 Indexing API 秒收录文章"的做法属于滥用，Google 可能不处理甚至惩罚。

### 2. Search Console API 提交 sitemap —— ✅ 可自动化，免费

这是**唯一合法且可自动化**的 Google 侧路径。

- 接口：`PUT https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/sitemaps/{feedpath}`
- 费用：免费
- 前提：站点需在 Search Console 完成验证；服务账号需被添加为站点用户

作用是**加快发现**，不是强制收录。Google 仍按自身策略决定是否收录、何时收录。

### 3. URL Inspection 手动请求编入索引 —— 有配额，无法批量

Search Console 界面上的"请求编入索引"有每日配额，且官方说明
"requesting a recrawl multiple times for the same URL won't get it crawled any faster"。
不适合自动化。

### 4. IndexNow —— ✅ 可自动化，但 Google 不参与

IndexNow 协议的参与方是 **Bing、Yandex、Seznam、Naver**。
**Google 从未加入该协议**。

对 Bing 等引擎，IndexNow 确实能显著加快收录；对 Google 完全无效。

## 那"自动化 SEO"到底能自动化什么

真正能自动化、且真正影响排名的是这些：

| 环节 | 能否自动化 | RankLoop 实现 |
| --- | --- | --- |
| 发布前拦截 SEO 缺陷 | ✅ | 29 条规则，critical 阻断发布 |
| 生成合规 HTML（title/description/canonical/OG/JSON-LD） | ✅ | 静态站生成器 |
| 生成并更新 sitemap | ✅ | 每次构建自动生成 |
| robots.txt 声明 sitemap | ✅ | 自动生成 |
| 提交 sitemap 给 Google | ✅ | Actions 中调用 GSC API |
| 通知 Bing/Yandex 等 | ✅ | IndexNow |
| **让 Google 立即收录** | ❌ | 不可能，Google 说了算 |
| **让内容排名靠前** | ❌ | 取决于内容质量与竞争度 |

## 排名靠前靠什么

排名由 Google 算法决定，主要取决于：

1. **内容质量与相关性** —— 是否真正回答了用户的搜索意图
2. **技术可抓取性** —— 这正是 RankLoop 保障的部分
3. **站点权威度** —— 外链、历史、品牌信号，需要长期积累
4. **用户行为信号** —— 点击率、停留时间

RankLoop 能确保第 2 项不拖后腿，并通过标题/描述质量检测间接改善第 1 项和第 4 项。
第 3 项无法通过工具速成。

## 接入 Google Search Console 自动提交

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 创建服务账号，
   启用 **Search Console API**，下载 JSON 密钥
2. 在 [Search Console](https://search.google.com/search-console) 中验证站点所有权
3. 站点设置 → 用户和权限 → 添加服务账号邮箱（`xxx@xxx.iam.gserviceaccount.com`），
   权限选"所有者"
4. 在 GitHub 仓库 Settings → Secrets → Actions 添加
   `GSC_SERVICE_ACCOUNT`，值为 JSON 密钥全文

配置后每次发布会自动提交 sitemap。未配置时该步骤会跳过并说明，不影响发布。

## 接入 IndexNow

1. 生成一个 8–128 位的随机字符串作为 Key
2. 在仓库 Settings → Variables → Actions 添加 `INDEXNOW_KEY`
3. 在站点根目录放置 `<key>.txt`，内容为 Key 本身
   （可在 `content/` 下创建对应文件）

## 现实预期

- **Bing/Yandex**：配置 IndexNow 后，通常数小时至一天内收录
- **Google**：新站首次收录通常需要几天到几周；已有权重的站点更快
- **排名**：需要数周至数月，取决于竞争度

任何承诺"24 小时上首页"的说法都不可信。
