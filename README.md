# RankLoop SEO

SEO 全生命周期管理平台。平台托管内容并执行 SEO 规则检测，第三方通过 API 提交内容、
获取不合格项、自行优化后重新提交，达标才允许发布。

**平台不介入 AI，不生成内容**——只提供接口与判定，优化由第三方自行完成。

## 闭环

```text
第三方 POST 内容
  → 平台跑 24 条 SEO 规则
  → 返回不合格项（规则编码 + 证据 + 修复建议）
  → 第三方自行优化后 PUT 更新
  → 重新检测（可多轮迭代）
  → 达标 → publish（存在 critical 问题时返回 422 拒绝）
  → sitemap 自动包含 + IndexNow 提交
```

## 三种部署方式

| 方式 | 成本 | 域名 | 适用 |
| --- | --- | --- | --- |
| **A. Cloudflare Pages（推荐）** | **免费**（500 构建/月） | 可绑根域名 | 内容站、博客、文档 |
| B. GitHub Pages | **免费** | 子路径 `/仓库名/` | 同上，无自有域名时 |
| C. Docker 自托管 | 需服务器 | 自定义 | 多租户、API 动态提交 |

A 和 B 都不需要 Docker 与数据库。**A 更推荐**：可绑根域名，
避免子路径带来的相对链接问题，且 Cloudflare CDN 对 SEO 更友好。

---

## 方式 A：Cloudflare Pages（免费，推荐）

```bash
CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=yyy \
  ./infra/scripts/cloudflare-pages-setup.sh rankloop https://你的域名
```

API Token 在 [Cloudflare 控制台](https://dash.cloudflare.com/profile/api-tokens)
创建，权限选 **Cloudflare Pages:Edit**。

配置自动部署：仓库 Settings → Secrets 添加 `CLOUDFLARE_API_TOKEN`、
`CLOUDFLARE_ACCOUNT_ID`；Variables 添加 `SITE_URL`。
之后修改 `content/` 推送到 main 即自动构建部署。

---

## 方式 B：GitHub Pages（免费）

```bash
# 1. 在 content/ 下新增 Markdown
# 2. 提交 PR → 自动跑 24 条 SEO 检测，不合格无法合并
# 3. 合并 → 自动构建、部署 Pages、提交搜索引擎
```

本地预览：

```bash
npm ci
SITE_URL=https://<用户名>.github.io/<仓库名> npm run site
```

首次使用需在仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。

自动化能力见 [docs/Google-SEO-自动化说明.md](docs/Google-SEO-自动化说明.md)。

---

## 方式 B：Docker 自托管

```bash
cp .env.example .env

# 必须替换为随机值，否则生产模式启动会直接失败
openssl rand -base64 32   # 填入 SESSION_SECRET
openssl rand -base64 32   # 填入 ENCRYPTION_KEY
openssl rand -hex 16      # 填入 POSTGRES_PASSWORD

docker compose up -d --build
docker compose exec api node /app/seed.mjs   # 输出 API Key，只显示一次
```

打开 <http://127.0.0.1:8080/console>，粘贴 API Key 即可使用管理控制台。

## 管理控制台与可视化面板

两个界面均由 API 进程直接提供（单容器、单域名，无需额外构建）：

**`/console` 管理控制台**（Alpine.js + Pico CSS，本地内置无 CDN）

- 总览：健康分、内容数、可发布/被拦截统计、常见问题排行
- 站点：添加、查看、软删除
- 内容：提交（HTML/Markdown）、查看检测详情、一键发布
- API Key：创建、查看、吊销

**`/` 可视化面板**（只读大屏）

- 平均健康分、30 天趋势折线、问题级别分布

数据全部来自 `/api/v1` 真实接口，无任何演示数据。

## 功能范围

已实现：

- 内容托管 CRUD，支持 HTML 与 Markdown 两种格式
- **24 条 SEO 规则**，分 critical / warning / notice 三级
- 可解释健康分（按规则权重扣分，可追溯每一分的来源）
- 发布门槛：critical 问题阻断发布
- 无状态预检接口（不落库，供发布前反复试算）
- Sitemap 与 robots.txt 自动生成
- **Google Search Console 全自动化**：验证所有权 → 添加站点 → 提交 sitemap → 回读确认
- 静态站生成器（GitHub Pages / Cloudflare Pages 免费部署）
- 配置驱动的站点自定义（导航、首页、配色，零代码）
- IndexNow 提交与**后台实际投递**（含幂等、跨站 URL 拦截、可重试/不可重试区分）
- API Key 认证与 scope 授权、多租户隔离
- 管理控制台 + 可视化面板
- 站点与 API Key 管理接口
- OpenAPI 3.1 文档
- Docker 一键部署 + GitHub Actions 自动构建镜像

明确不做（第一版）：

- 不接入生成式 AI，不生成文章与 SEO 文案
- 不承诺"保证收录"或"强制排名"
- 不实现黑帽 SEO

尚未实现（二期）：

- 外部站点抓取与 SSRF 防护
- 网站所有权验证（针对用户自有站点；平台托管站点已支持 Google 自动验证）
- Search Console 搜索表现数据同步（点击 / 曝光 / 排名，当前只做提交）
- Webhook 实际投递（签名与重试逻辑已实现并有测试，缺投递器）

详见 [docs/ADR-001-内容托管闭环.md](docs/ADR-001-内容托管闭环.md)。

## 关于 Google 收录

必须如实说明：**没有任何工具可以强制 Google 收录**。本平台的作用是

1. 检测并阻止会导致不被收录的问题（noindex、缺 title、canonical 跨域、空内容等）；
2. 自动生成 sitemap 并在 robots.txt 中声明，让 Google 更快发现；
3. 通过 IndexNow 通知 Bing / Yandex / Seznam / Naver —— **Google 不支持该协议**。

Google 侧的收录仍取决于其自身抓取策略与内容质量。

## API

统一前缀 `/api/v1`，认证：`Authorization: Bearer rkl_live_xxx`

| 方法 | 路径 | scope | 说明 |
| --- | --- | --- | --- |
| GET | `/rules` | 公开 | 24 条规则清单与权重 |
| GET | `/openapi.json` | 公开 | OpenAPI 3.1 文档 |
| POST | `/sites/:siteId/contents` | `contents:write` | 提交内容并检测 |
| GET | `/sites/:siteId/contents` | `contents:read` | 列出站点内容 |
| GET | `/contents/:contentId` | `contents:read` | 查看内容与检测结果 |
| PUT | `/contents/:contentId` | `contents:write` | 更新内容，产生新版本 |
| POST | `/contents/check` | `contents:write` | 无状态预检，不落库 |
| POST | `/contents/:contentId/publish` | `contents:publish` | 发布，critical 时 422 |
| GET | `/stats/overview` | `contents:read` | 面板总览统计 |
| GET | `/stats/trend` | `contents:read` | 30 天健康分趋势 |
| GET | `/sites/:siteId/sitemap.xml` | `indexing:read` | 已发布内容的 sitemap |
| GET | `/sites/:siteId/robots.txt` | `indexing:read` | robots.txt |
| POST | `/sites/:siteId/indexnow/key` | `indexing:write` | 配置 IndexNow Key |
| POST | `/sites/:siteId/indexnow/submit` | `indexing:write` | 提交 URL（幂等） |
| GET | `/sites/:siteId/indexnow/submissions` | `indexing:read` | 提交记录 |
| GET | `/sites` | `sites:read` | 列出站点 |
| POST | `/sites` | `sites:write` | 添加站点 |
| DELETE | `/sites/:siteId` | `sites:write` | 归档站点（软删除） |
| GET | `/api-keys` | `sites:read` | 列出 API Key（不含明文） |
| POST | `/api-keys` | `sites:write` | 创建 Key（明文仅返回一次） |
| DELETE | `/api-keys/:keyId` | `sites:write` | 吊销 Key |

### 示例：提交 → 修复 → 发布

```bash
KEY=rkl_live_xxx
SITE=<site_id>

# 提交（缺 title，会被判 critical）
curl -X POST "http://127.0.0.1:8080/api/v1/sites/$SITE/contents" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"path":"/article","format":"markdown","body":"# 标题\n\n短"}'
# → score 13，critical: MISSING_TITLE / EMPTY_CONTENT

# 发布被拦截
curl -X POST "http://127.0.0.1:8080/api/v1/contents/<id>/publish" -H "Authorization: Bearer $KEY"
# → 422 SEO_GATE_FAILED，details.blocking 列出阻塞规则

# 修复后更新 → score 90，publishable: true → 再次发布返回 200
```

### Markdown 元数据

Markdown 的 title / description / canonical 通过 frontmatter 提供：

```markdown
---
title: 如何优化网站的搜索引擎排名完整指南
description: 本文详细介绍网站 SEO 优化的核心方法……
canonical: https://example.com/article
lang: zh-CN
og:
  title: SEO 指南
  description: 完整指南
  image: https://example.com/og.png
---

# 正文标题
```

平台负责渲染并生成 `<head>`，因此 HTML 与 Markdown 跑同一套规则、结论一致
（有等价性测试保证，第三方无法通过切换格式绕过门槛）。

## 架构

按 DDD 分层，依赖方向由外向内：

```text
apps/api/src/
  domain/          领域层：聚合根、值对象、领域异常、仓储接口（不依赖框架与数据库）
  application/     应用层：用例编排、事务边界
  infrastructure/  基础设施层：Prisma 仓储实现、规则引擎适配、IndexNow 投递
  interfaces/      接口层：HTTP 路由、错误映射、管理控制台与面板
  shared/          跨层工具：URL 规范化、API Key、Webhook 签名
packages/
  seo-rules/       规则引擎（输入无关，二期爬虫可直接复用）
  db/              Prisma schema 与迁移
```

发布门槛等业务规则住在 `domain/content/content.ts` 聚合根中，
任何调用方（HTTP、队列、脚本）都无法绕过。

## 本地开发

```bash
npm ci
npm run generate     # 生成 Prisma Client，typecheck 依赖它
npm test             # 160 个测试
npm run typecheck
npm run build
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `development` | 生产模式下使用示例密钥会拒绝启动 |
| `PORT` | `8080` | API 端口 |
| `APP_URL` | `http://localhost:3000` | 对外地址 |
| `DATABASE_URL` | — | PostgreSQL 连接串，必填 |
| `REDIS_URL` | `redis://redis:6379` | Redis 连接串 |
| `SESSION_SECRET` | — | 至少 32 字节随机值，必填 |
| `ENCRYPTION_KEY` | — | 至少 32 字节随机值，必填 |
| `REGISTRATION_MODE` | `invite` | `open` / `invite` / `closed` |
| `LOG_LEVEL` | `info` | 日志级别 |
| `DEFAULT_MAX_SITES` | `5` | 每工作区站点数配额 |
| `DEFAULT_MAX_CONTENTS` | `1000` | 每工作区内容数配额 |

## 镜像

GitHub Actions 自动构建并推送到 GHCR，支持 `linux/amd64` 与 `linux/arm64`：

```text
ghcr.io/lordfoxfairy/rankloop:main          # main 分支
ghcr.io/lordfoxfairy/rankloop:v1.2.3        # 版本标签
ghcr.io/lordfoxfairy/rankloop:latest        # 正式 tag
ghcr.io/lordfoxfairy/rankloop:sha-abc1234   # 单次提交
```

部署与升级见 [DEPLOY.md](DEPLOY.md)。

## 安全

- API Key 只存 SHA-256 哈希，明文仅创建时返回一次
- 跨租户访问返回 404 而非 403，避免泄露资源是否存在
- 内容路径阻断 `..` 与 `%2e%2e` 编码绕过
- IndexNow 只接受属于本站点的 URL
- Webhook 签名覆盖时间戳，防重放
- 容器以非 root 用户运行，数据库与 Redis 不映射公网
- 生产模式使用示例密钥直接拒绝启动

发现安全问题请通过 GitHub Issue 私下联系维护者。

## License

[MIT](LICENSE)
