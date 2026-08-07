# RankLoop SEO 项目完整规格与 CC 执行文档

> 文档用途：将本文件直接交给 Claude Code（下称 CC），让其在新建 Git 仓库中完成项目初始化、开发、测试、Docker 化、GitHub Actions 自动构建 GHCR 镜像，并输出服务器与 Cloudflare 部署说明。
>
> 项目暂定名称：**RankLoop SEO**
>
> 产品定位：一个仅聚焦 SEO 的多租户闭环平台，既可管理自己的多个网站，也可提供给外部用户使用，并开放稳定的 REST API 与 Webhook。

---

## 0. 给 CC 的总指令

你需要直接实现一个可运行、可测试、可通过 Docker 部署的 RankLoop SEO MVP，不要只输出方案、伪代码或静态页面。

执行原则：

1. 先阅读本文件全部内容，再建立实施计划。
2. 在当前仓库直接开发；缺少仓库时初始化 Git 项目。
3. 优先做完整闭环，不堆砌尚不可用的菜单和假数据。
4. 所有敏感信息必须由环境变量注入，严禁提交密钥、Token、Cookie、OAuth Secret。
5. 所有外部请求、爬虫、队列和定时任务必须有超时、限流、重试和审计日志。
6. 多租户数据必须严格隔离；任意 API 都不能通过修改 ID 访问其他工作区数据。
7. UI 必须使用真实后端 API，不允许在生产代码中硬编码演示数据。
8. 每完成一个阶段都运行 lint、类型检查、单元测试和必要的集成测试。
9. 提交前必须通过 `docker compose up -d --build` 完成端到端验证。
10. 若某项功能受第三方接口权限或配额限制，必须实现清晰状态与错误信息，不得伪造成功。

最终必须交付：

- 完整源代码；
- 数据库迁移；
- OpenAPI 文档；
- Dockerfile 与 `compose.yaml`；
- `.env.example`；
- GitHub Actions 工作流；
- 自动化测试；
- `README.md`；
- `DEPLOY.md`；
- 安全说明与已知限制。

---

## 1. 产品目标与边界

### 1.1 产品目标

RankLoop SEO 形成以下闭环：

```text
网站接入
  → 全站抓取
  → SEO 问题检测
  → 生成修复任务
  → 用户修复
  → 平台复检
  → Sitemap / IndexNow 提交
  → Google 收录与搜索表现监控
  → 趋势复盘
  → 进入下一轮优化
```

平台必须同时支持：

- 管理员管理自己的站点；
- 外部用户注册并管理自己的站点；
- 多工作区、多站点；
- Web 面板操作；
- 外部系统通过 API 调用；
- Webhook 接收任务完成或异常事件。

### 1.2 第一版明确不做

- 不接入生成式 AI，不生成文章和 SEO 文案；
- 不承诺或伪造“保证收录”“强制排名”；
- 不实现黑帽 SEO、站群作弊、垃圾外链、关键词堆砌；
- 不替外部用户绕过网站所有权验证；
- 不提供通用 Google 普通网页批量强制收录功能；
- 不在第一版开发复杂计费系统；
- 不在第一版抓取整个互联网或构建自有搜索引擎索引。

### 1.3 搜索引擎能力边界

- Google Search Console API：用于 Search Analytics、站点、Sitemap 和 URL Inspection。
- Google 普通网页：平台可以检查状态、提交 Sitemap、诊断阻碍，但不得宣称可强制收录。
- IndexNow：用于通知支持该协议的搜索引擎 URL 已新增、更新或删除。
- Bing Webmaster API：可作为后续或可选集成，用于 Bing 数据和提交能力。

---

## 2. 用户与权限模型

### 2.1 角色

平台级角色：

- `platform_admin`：平台管理员，可管理用户、工作区、系统任务、配额与审计。
- `user`：普通平台注册用户。

工作区角色：

- `owner`：工作区所有者，管理成员、站点、集成和 API Key。
- `admin`：管理工作区站点和任务，但不能转移所有权。
- `editor`：发起抓取、处理问题、提交 URL。
- `viewer`：只读查看。

### 2.2 多租户隔离

- 所有业务表必须带 `workspace_id`，或能通过外键唯一追溯到工作区。
- 服务端从已认证身份和成员关系计算授权，不信任客户端传入的工作区权限。
- 禁止仅凭可枚举数字 ID 读取数据；使用 UUID/ULID，并且仍需权限校验。
- API Key 归属于一个工作区，可配置 scope。
- OAuth 凭据按工作区加密保存。

### 2.3 第一版注册策略

- 支持关闭公开注册；
- 支持邀请码注册；
- 初始默认建议：`REGISTRATION_MODE=invite`；
- 平台管理员可创建、禁用用户与邀请码。

---

## 3. 核心业务模块

### 3.1 总览 Dashboard

展示真实数据：

- SEO 健康分；
- 页面总数；
- 可索引页面数；
- 严重/警告/建议问题数；
- 最近一次抓取状态；
- Google 点击、曝光、CTR、平均位置；
- 关键词上涨与下跌；
- IndexNow 最近提交成功率；
- 待处理任务；
- 7 天、28 天、90 天趋势；
- 数据更新时间与数据源状态。

### 3.2 网站管理

功能：

- 添加、编辑、归档站点；
- 支持多个协议和主机，但统一规范化 URL；
- 配置允许抓取范围、最大页面数、抓取频率、并发数；
- 网站所有权验证；
- 查看最近抓取、集成、Sitemap、IndexNow 状态。

所有权验证至少实现两种：

1. DNS TXT 验证；
2. 根目录验证文件。

可选第三种：HTML Meta 标签验证。

未验证站点：

- 不允许定时大规模抓取；
- 不允许使用平台代管的 IndexNow Key 提交；
- 不允许连接需要所有权的搜索平台功能。

### 3.3 全站爬虫

爬虫必须：

- 从站点首页和 Sitemap 发现 URL；
- 遵守 robots.txt；
- 只抓取已验证站点的允许范围；
- 限制并发、总页面数、响应体大小和超时；
- 防止 SSRF；
- 禁止访问回环、内网、链路本地、云元数据地址和非 HTTP(S) 协议；
- 处理重定向并对每跳重新校验目标地址；
- 提取可抓取 `<a href>` 链接；
- 记录状态码、响应时间、内容类型、页面大小和最终 URL；
- 对 HTML 解析 title、description、H1-H6、canonical、robots meta、图片 alt、语言、结构化数据和内外链；
- 对抓取失败提供明确原因；
- 支持手动停止任务；
- 同一站点同一时间默认只允许一个全量抓取任务。

MVP 不要求执行浏览器级 JavaScript 渲染。遇到正文主要依赖 JavaScript 时标记 `javascript_rendering_suspected`，后续版本再增加 Playwright 渲染队列。

### 3.4 SEO 检测规则

严重问题 `critical`：

- 页面返回 5xx；
- 重要页面被 `noindex`；
- canonical 指向不可访问页面；
- robots.txt 阻断需要收录的页面；
- 重定向循环；
- Sitemap URL 大量不可访问；
- 页面没有可解析正文且疑似空页面。

警告 `warning`：

- 4xx 页面；
- title 缺失、重复或明显过长/过短；
- description 缺失或重复；
- H1 缺失或多个 H1；
- canonical 缺失、自相矛盾或跨域异常；
- 重定向链过长；
- 孤立页面；
- 内部死链；
- 图片缺少 alt；
- 结构化数据 JSON 解析失败；
- HTTP 页面或混合内容链接；
- 页面过慢或响应体异常大；
- Sitemap 中包含 noindex、重定向或错误页面。

建议 `notice`：

- 内链较少；
- 标题与 H1 完全无关；
- 缺少语言属性；
- 缺少 Open Graph 基础字段；
- 内容更新时间长期不变；
- 页面深度过深。

每条问题必须包括：

- 规则编码；
- 严重级别；
- URL；
- 证据；
- 人类可读说明；
- 明确修复建议；
- 首次发现、最近发现、是否已修复；
- 关联抓取任务；
- 规则版本。

不要使用一个无法解释的总分替代具体问题。健康分必须由可配置权重计算，并能查看扣分来源。

### 3.5 SEO 任务闭环

- 用户可把一个或多个问题转换为修复任务；
- 任务状态：`open`、`in_progress`、`resolved_pending_check`、`verified`、`reopened`、`ignored`；
- 用户提交“已修复”后，系统只复抓相关 URL；
- 规则通过后自动标记 `verified`；
- 未通过则 `reopened` 并保存新证据；
- 所有状态变化写入历史记录和审计日志。

### 3.6 Sitemap 管理

- 发现 robots.txt 中声明的 Sitemap；
- 允许用户手动添加 Sitemap URL；
- 解析 Sitemap index 与普通 Sitemap；
- 检查 URL 数量、重复项、格式、状态码和 lastmod；
- 对 Sitemap 中的异常 URL 生成问题；
- 连接 Google Search Console 后允许提交 Sitemap；
- 保存提交记录、响应和最近状态；
- 不自动篡改外部用户网站文件。

### 3.7 IndexNow

- 每个站点独立配置 IndexNow Key；
- 支持验证 Key 文件位置；
- 支持单 URL 和批量 URL 提交；
- 事件类型：`added`、`updated`、`deleted`；
- 去重、批处理、重试和速率限制；
- 记录请求、响应码、响应摘要和最终状态；
- 外部 API 请求先进入队列，不能在 HTTP 请求线程内长时间阻塞；
- 只有通过所有权验证且 URL 属于该站点的请求才接受。

### 3.8 Google Search Console 集成

OAuth 流程：

- 用户主动连接 Google；
- 最小权限原则；
- OAuth `state` 防 CSRF；
- Refresh Token 加密存储；
- 可断开连接并删除 Token；
- 不在日志中打印 Token。

同步能力：

- 获取用户可访问的 Search Console 属性；
- 绑定站点与属性；
- 同步 Search Analytics；
- 维度至少支持 date、query、page、country、device；
- 指标：clicks、impressions、ctr、position；
- 同步 Sitemap；
- URL Inspection 按需和配额执行；
- 保存同步游标、时间范围、错误和配额状态；
- 对数据延迟显示明确提示。

注意：URL Inspection 返回的是 Google 索引中版本的状态，不等同于实时抓取测试。

### 3.9 关键词与页面表现

第一版关键词数据来自 Search Console，不自行模拟全网实时排名。

功能：

- 按查询词查看点击、曝光、CTR、平均位置；
- 按页面查看；
- 时间段对比；
- 上涨/下跌排序；
- 关键词与落地页组合；
- 数据导出 CSV；
- 明确显示数据来源与同步时间。

### 3.10 报告

- 站点健康摘要；
- 问题变化；
- 修复任务进展；
- Search Console 数据变化；
- 收录状态抽查；
- IndexNow 提交结果；
- 支持页面查看与 CSV 导出；
- PDF 可在 MVP 后半阶段实现，但不能阻塞核心闭环。

---

## 4. 信息架构与页面

### 4.1 公开页面

- `/`：产品介绍；
- `/features`：功能；
- `/docs`：API 与接入文档；
- `/login`；
- `/register`（根据注册模式启停）；
- `/privacy`；
- `/terms`；
- `/status`（可选）。

### 4.2 登录后页面

```text
/app/overview
/app/sites
/app/sites/:siteId/overview
/app/sites/:siteId/pages
/app/sites/:siteId/issues
/app/sites/:siteId/tasks
/app/sites/:siteId/crawls
/app/sites/:siteId/sitemaps
/app/sites/:siteId/indexing
/app/sites/:siteId/keywords
/app/sites/:siteId/analytics
/app/reports
/app/api-keys
/app/webhooks
/app/members
/app/settings
```

### 4.3 平台管理页面

```text
/admin/users
/admin/workspaces
/admin/jobs
/admin/quotas
/admin/audit
/admin/system
```

### 4.4 UI 要求

- 桌面端优先，但移动端必须可查看核心数据；
- 明暗主题可选，不作为阻塞项；
- 图表有空状态、加载状态和错误状态；
- 表格支持筛选、排序和分页；
- 危险操作二次确认；
- 后台中文优先，并保留 i18n 结构；
- 不使用廉价模板感过强的视觉；
- 可访问性：表单 label、键盘操作、合理对比度；
- 禁止用颜色作为唯一状态表达方式。

---

## 5. 推荐技术架构

CC 可在不降低需求的前提下调整具体库，但必须在 README 说明原因。

建议采用单仓库：

```text
rankloop-seo/
├── apps/
│   ├── web/          # Next.js：公开站与管理面板
│   ├── api/          # Fastify/NestJS API
│   └── worker/       # 队列消费者、爬虫、同步任务
├── packages/
│   ├── db/           # Prisma/Drizzle schema 与迁移
│   ├── shared/       # 类型、校验、错误码
│   ├── seo-rules/    # SEO 规则引擎
│   └── sdk/          # TypeScript API SDK
├── infra/
│   ├── nginx/
│   └── scripts/
├── .github/workflows/
├── compose.yaml
├── Dockerfile
├── .env.example
├── README.md
└── DEPLOY.md
```

推荐组件：

- 前端：Next.js + TypeScript；
- API：Node.js + TypeScript + Fastify 或 NestJS；
- 数据库：PostgreSQL；
- ORM：Prisma 或 Drizzle；
- 队列与缓存：Redis + BullMQ；
- 爬虫解析：Undici + Cheerio；
- 校验：Zod；
- API 文档：OpenAPI 3.1；
- 测试：Vitest/Jest + Playwright；
- 图表：ECharts 或 Recharts；
- 日志：结构化 JSON 日志，生产环境隐藏敏感字段。

部署进程：

- `web`：公开站和面板；
- `api`：REST API、认证、OAuth 回调；
- `worker`：爬取、检测、同步、IndexNow、Webhook；
- `postgres`；
- `redis`；
- `reverse-proxy`：Nginx/Caddy，或由现有 1Panel 反代。

---

## 6. 数据库核心模型

至少实现以下实体：

```text
users
workspaces
workspace_members
invitations
sessions

sites
site_verifications
site_settings
integrations
oauth_credentials

crawl_jobs
crawl_pages
page_links
page_snapshots
seo_issues
seo_issue_occurrences
seo_tasks
seo_task_events

sitemaps
sitemap_urls
sitemap_submissions
indexnow_keys
indexnow_submissions

gsc_properties
gsc_sync_jobs
search_analytics_daily
url_inspections

api_keys
webhooks
webhook_deliveries
audit_logs
system_jobs
```

关键约束：

- 邮箱唯一性做不区分大小写处理；
- 工作区成员 `(workspace_id, user_id)` 唯一；
- 站点规范化 origin 在同一工作区唯一；
- 页面 `(site_id, normalized_url)` 唯一；
- API Key 数据库只保存哈希和前缀，明文只在创建时展示一次；
- OAuth Token 加密后保存；
- 时间统一存 UTC；
- 软删除只用于确有恢复需求的数据；
- 高频明细表建立合理复合索引与保留策略。

---

## 7. REST API v1

统一前缀：`/api/v1`

### 7.1 认证

Web 会话与 API Key 分开：

```http
Authorization: Bearer rkl_live_xxxxxxxxx
```

API Key scopes：

- `sites:read`
- `sites:write`
- `crawls:read`
- `crawls:write`
- `issues:read`
- `tasks:write`
- `indexing:read`
- `indexing:write`
- `analytics:read`
- `webhooks:write`

### 7.2 核心端点

```text
POST   /auth/register
POST   /auth/login
POST   /auth/logout
GET    /me

GET    /workspaces
POST   /workspaces
GET    /workspaces/:workspaceId/members
POST   /workspaces/:workspaceId/invitations

GET    /sites
POST   /sites
GET    /sites/:siteId
PATCH  /sites/:siteId
POST   /sites/:siteId/verifications
POST   /sites/:siteId/verifications/check

POST   /sites/:siteId/crawls
GET    /sites/:siteId/crawls
GET    /crawls/:crawlId
POST   /crawls/:crawlId/cancel

GET    /sites/:siteId/pages
GET    /sites/:siteId/pages/:pageId
GET    /sites/:siteId/issues
GET    /sites/:siteId/issues/summary

POST   /sites/:siteId/tasks
GET    /sites/:siteId/tasks
PATCH  /tasks/:taskId
POST   /tasks/:taskId/recheck

GET    /sites/:siteId/sitemaps
POST   /sites/:siteId/sitemaps
POST   /sitemaps/:sitemapId/check
POST   /sitemaps/:sitemapId/submit/google

POST   /sites/:siteId/indexnow/submit
GET    /sites/:siteId/indexnow/submissions

GET    /sites/:siteId/search-analytics
GET    /sites/:siteId/keywords
POST   /sites/:siteId/url-inspections
GET    /sites/:siteId/url-inspections

GET    /api-keys
POST   /api-keys
DELETE /api-keys/:keyId

GET    /webhooks
POST   /webhooks
PATCH  /webhooks/:webhookId
DELETE /webhooks/:webhookId
```

### 7.3 通用响应

成功：

```json
{
  "data": {},
  "meta": {
    "request_id": "req_..."
  }
}
```

错误：

```json
{
  "error": {
    "code": "SITE_NOT_VERIFIED",
    "message": "该网站尚未完成所有权验证",
    "details": {}
  },
  "meta": {
    "request_id": "req_..."
  }
}
```

异步任务返回 `202 Accepted`：

```json
{
  "data": {
    "job_id": "job_...",
    "status": "queued"
  }
}
```

### 7.4 IndexNow 外部调用示例

```http
POST /api/v1/sites/site_01/indexnow/submit
Authorization: Bearer rkl_live_xxx
Content-Type: application/json
Idempotency-Key: 9c67d8a3-...
```

```json
{
  "event": "updated",
  "urls": [
    "https://example.com/article-a",
    "https://example.com/article-b"
  ]
}
```

所有 URL 必须规范化并验证属于当前站点。

### 7.5 Webhook

事件：

- `crawl.completed`
- `crawl.failed`
- `issue.detected`
- `task.verified`
- `task.reopened`
- `indexnow.completed`
- `gsc.sync.completed`
- `gsc.sync.failed`

要求：

- HMAC-SHA256 签名；
- 时间戳与事件 ID；
- 至少一次投递语义；
- 指数退避重试；
- 接收方可根据事件 ID 去重；
- 后台可查看投递记录并手动重试；
- 禁止向内网地址发送 Webhook，防止 SSRF。

---

## 8. 安全要求

### 8.1 SSRF 防护

这是项目最高优先级安全项：

- 仅允许 `http:`、`https:`；
- DNS 解析后拒绝回环、私网、链路本地、保留地址、组播地址；
- 拒绝 `localhost` 和常见云元数据域名/IP；
- 每次重定向重新解析并校验；
- 防止 DNS rebinding；
- 限制端口，默认仅 80/443；
- 限制响应体大小和总下载时间；
- 不把原始 HTML 无限制写入数据库；
- HTML 预览必须消毒，不能执行脚本。

### 8.2 认证与凭据

- 密码使用 Argon2id；
- Cookie：HttpOnly、Secure、SameSite；
- 登录、注册、找回密码限流；
- CSRF 防护；
- OAuth state 验证；
- API Key 只存哈希；
- 敏感字段日志脱敏；
- 管理操作写审计日志；
- 生产环境启动时若使用默认密钥则直接失败。

### 8.3 配额

每工作区默认配额可通过环境变量或数据库配置：

- 站点数；
- 每次抓取最大页面数；
- 每日抓取次数；
- URL Inspection 次数；
- IndexNow 提交次数；
- API 请求速率；
- Webhook 数量。

---

## 9. 后台任务与调度

队列至少包括：

```text
crawl
seo-analysis
task-recheck
sitemap-check
indexnow-submit
gsc-sync
url-inspection
webhook-delivery
retention-cleanup
```

要求：

- 任务幂等；
- 失败重试有上限；
- 区分可重试和不可重试错误；
- 指数退避和随机抖动；
- 保存任务进度；
- Worker 重启后任务不丢失；
- 支持死信状态；
- 管理员可查看失败原因并重试；
- 定时任务使用分布式锁，避免多 Worker 重复执行。

---

## 10. Docker 与本地开发

### 10.1 Docker 目标

必须支持：

```bash
cp .env.example .env
docker compose up -d --build
```

启动后至少有：

```text
http://localhost:3000  Web
http://localhost:8080  API
```

可由反代统一成单域名：

```text
/api/*  → api:8080
/*      → web:3000
```

### 10.2 Dockerfile

- 多阶段构建；
- 固定基础镜像主版本；
- 非 root 用户运行；
- 仅复制运行所需文件；
- 提供健康检查；
- 生产镜像不包含开发依赖和源代码缓存；
- 构建支持 `linux/amd64`，可选 `linux/arm64`。

### 10.3 Compose

服务：

```text
web
api
worker
postgres
redis
reverse-proxy（可选，若 1Panel 已负责则通过 profile 关闭）
```

要求：

- PostgreSQL 和 Redis 使用命名卷；
- 服务健康检查；
- API/Worker 等待数据库可用；
- 自动迁移必须有明确策略，不能多实例并发迁移；
- 数据库和 Redis 默认不映射到公网；
- 使用 restart policy；
- 日志轮转；
- 备份命令写入 `DEPLOY.md`。

### 10.4 `.env.example`

至少包括：

```dotenv
NODE_ENV=production
APP_URL=https://seo.example.com
API_URL=https://seo.example.com/api

POSTGRES_DB=rankloop
POSTGRES_USER=rankloop
POSTGRES_PASSWORD=change-me
DATABASE_URL=postgresql://rankloop:change-me@postgres:5432/rankloop
REDIS_URL=redis://redis:6379

SESSION_SECRET=change-to-at-least-32-random-bytes
ENCRYPTION_KEY=change-to-32-byte-key

REGISTRATION_MODE=invite
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=change-me-on-first-login

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://seo.example.com/api/v1/integrations/google/callback

DEFAULT_MAX_SITES=5
DEFAULT_MAX_PAGES_PER_CRAWL=1000
DEFAULT_DAILY_CRAWLS=2
CRAWLER_CONCURRENCY=3
CRAWLER_TIMEOUT_MS=15000
CRAWLER_MAX_BODY_BYTES=5242880

LOG_LEVEL=info
```

README 必须提示用户生成随机强密钥，不能直接使用示例值。

---

## 11. GitHub Actions 与 GHCR

### 11.1 CI

在 Pull Request 和主分支 push 时运行：

- 安装依赖；
- lint；
- 类型检查；
- 单元测试；
- API 集成测试；
- 构建；
- Docker build 验证；
- 可选依赖漏洞扫描。

### 11.2 发布镜像

创建 `.github/workflows/docker-publish.yml`：

- 触发：推送 `main`、版本标签 `v*`、手动触发；
- 登录 `ghcr.io`；
- 使用 GitHub Actions 自带 `GITHUB_TOKEN` 和最小权限；
- 构建并推送 Web/API/Worker 镜像，或构建一个通过启动命令区分进程的统一镜像；
- 标签：
  - `sha-<shortsha>`；
  - `main`；
  - `v1.2.3`；
  - 正式 tag 时更新 `latest`；
- 使用 BuildKit cache；
- 输出镜像 digest；
- 推荐生成 SBOM 并签名；
- 不在日志输出 Registry Token。

镜像命名示例：

```text
ghcr.io/<github-owner>/rankloop-seo-web:latest
ghcr.io/<github-owner>/rankloop-seo-api:latest
ghcr.io/<github-owner>/rankloop-seo-worker:latest
```

若使用统一镜像：

```text
ghcr.io/<github-owner>/rankloop-seo:latest
```

### 11.3 自动部署边界

第一版默认：GitHub 自动构建并推送镜像，服务器部署由明确的更新命令执行：

```bash
docker compose pull
docker compose up -d
```

可以额外提供一个受保护的 `deploy-production.yml`，但只有用户明确配置服务器 Deploy Key、GitHub Environment 与审批规则后才启用。不得默认把生产 SSH 私钥写进仓库。

---

## 12. 服务器与 Cloudflare 部署

### 12.1 正确链路

```text
GitHub 仓库
  → GitHub Actions 构建
  → GHCR Docker 镜像
  → 用户服务器 Docker Compose
  → Nginx / Caddy / 1Panel 反向代理
  → Cloudflare DNS 代理
  → 用户访问
```

Cloudflare 负责：

- DNS；
- HTTPS 边缘证书；
- 反向代理；
- 基础缓存；
- WAF 与 DDoS 防护；
- 可选 Cloudflare Tunnel。

Cloudflare 不直接运行本项目的普通 Docker 镜像。

### 12.2 推荐域名

项目独立时推荐：

```text
rankloop.miaokit.cloud
```

未来独立品牌域名确定后可迁移。应用必须通过 `APP_URL` 配置域名，不得硬编码。

### 12.3 方案 A：Cloudflare 代理源站

1. 服务器启动 Compose；
2. 1Panel/Nginx 反代到 `127.0.0.1:3000` 和 `127.0.0.1:8080`；
3. Cloudflare 添加 A/AAAA 记录指向服务器；
4. 开启代理（橙色云）；
5. SSL/TLS 使用 Full (strict)；
6. 源站安装 Cloudflare Origin Certificate 或可信证书；
7. 防火墙只开放必要端口；
8. PostgreSQL、Redis、内部 API 不直接暴露公网。

### 12.4 方案 B：Cloudflare Tunnel

可选使用 `cloudflared` 容器将服务连接到 Cloudflare，不直接开放源站入站端口。文档中提供独立 Compose profile 或示例覆盖文件，但 Tunnel Token 必须由环境变量注入。

### 12.5 Cloudflare 缓存规则

- 静态资源可长缓存并使用文件指纹；
- `/api/*`、登录页面、OAuth 回调、面板用户数据默认绕过缓存；
- 不缓存带授权头或会话 Cookie 的响应；
- 不缓存 Webhook；
- 安全响应头应由应用或反代统一设置。

---

## 13. 测试与验收标准

### 13.1 单元测试

- URL 规范化；
- 内网/保留地址识别；
- 重定向 SSRF 防护；
- robots.txt 处理；
- title、meta、canonical、heading 提取；
- SEO 规则与评分；
- API Key 哈希校验；
- 权限矩阵；
- Webhook 签名；
- IndexNow 批处理与去重。

### 13.2 集成测试

- 注册/登录/登出；
- 邀请码模式；
- 创建工作区与站点；
- 两种网站验证；
- 发起抓取并得到页面与问题；
- 把问题转换为任务；
- 修复后复检并验证任务；
- IndexNow 入队和提交记录；
- API Key scope；
- 跨租户访问必须返回 403/404；
- OAuth 回调 state 校验；
- Webhook 失败重试。

### 13.3 E2E 验收

必须准备一个本地测试站点，包含：

- 正常页面；
- 缺 title 页面；
- 重复 title 页面；
- noindex 页面；
- canonical 错误页面；
- 404 链接；
- 重定向链；
- Sitemap；
- robots.txt。

E2E 流程：

1. 管理员登录；
2. 创建工作区；
3. 添加本地测试站点；
4. 完成测试模式验证；
5. 发起抓取；
6. 查看检测结果；
7. 创建修复任务；
8. 更改测试页面；
9. 复检；
10. 任务变为 verified；
11. 创建 API Key；
12. 通过 API 查询站点与问题。

### 13.4 Docker 验收

- 全新环境一条 Compose 命令启动；
- 健康检查全部通过；
- 重启后 PostgreSQL 数据不丢失；
- Worker 重启后队列任务不丢失；
- 数据库和 Redis 不暴露公网；
- 默认密钥在生产模式下会阻止启动；
- 镜像以内置非 root 用户运行。

### 13.5 完成定义

只有同时满足以下条件才算 MVP 完成：

- 至少一条真实抓取闭环可运行；
- 至少 10 条明确 SEO 规则可检测；
- 问题可转任务并复检；
- IndexNow 可真实提交或在测试环境使用可验证 Mock；
- Search Console OAuth 与数据同步代码完整，缺凭据时显示未配置而非假数据；
- 多租户权限测试通过；
- OpenAPI 文档可访问；
- Docker Compose 启动通过；
- GitHub Actions 配置完成；
- README 和部署文档完整。

---

## 14. 开发阶段建议

### 阶段 1：工程底座

- Monorepo；
- Web/API/Worker；
- PostgreSQL/Redis；
- 认证、用户、工作区、权限；
- Compose 与 CI。

### 阶段 2：站点与爬虫

- 添加站点；
- 所有权验证；
- SSRF 防护；
- 爬取队列；
- 页面和链接入库。

### 阶段 3：规则与任务闭环

- SEO 规则引擎；
- 问题界面；
- 健康分；
- 修复任务；
- URL 定向复检。

### 阶段 4：提交与监控

- Sitemap；
- IndexNow；
- Google OAuth；
- Search Analytics；
- URL Inspection。

### 阶段 5：面板、API 与交付

- 趋势图；
- 报告；
- API Key；
- Webhook；
- OpenAPI；
- 安全测试；
- Docker 镜像发布；
- 部署文档。

每一阶段都要保持主分支可运行，不要等到最后才集成。

---

## 15. README 必须包含

- 项目简介与截图位置；
- 功能范围和明确边界；
- 架构图；
- 本地开发步骤；
- Docker 启动步骤；
- 环境变量表；
- 数据库迁移；
- 创建初始管理员；
- API 文档地址；
- Google OAuth 配置；
- IndexNow 配置；
- GitHub Actions/GHCR；
- 生产部署与升级；
- 备份和恢复；
- 安全披露方式；
- License。

---

## 16. 生产运维要求

- `/health/live`：进程存活；
- `/health/ready`：数据库和 Redis 就绪；
- 请求 ID；
- 结构化日志；
- 队列积压指标；
- 抓取成功率；
- 外部 API 错误率；
- 数据库备份与恢复命令；
- 版本升级前迁移说明；
- 旧镜像至少保留一个可回滚版本；
- 定时清理过期原始抓取数据；
- 不删除长期趋势所需的聚合数据。

---

## 17. 官方参考资料

- Google Search Console API：<https://developers.google.com/webmaster-tools/v1/api_reference_index>
- Search Analytics Query：<https://developers.google.com/webmaster-tools/v1/searchanalytics/query>
- URL Inspection：<https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect>
- Sitemap Submit：<https://developers.google.com/webmaster-tools/v1/sitemaps/submit>
- Google Search Essentials：<https://developers.google.com/search/docs/essentials>
- Google SEO Starter Guide：<https://developers.google.com/search/docs/fundamentals/seo-starter-guide>
- Sitemap 指南：<https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview>
- IndexNow 文档：<https://www.indexnow.org/documentation>
- Bing Webmaster API：<https://learn.microsoft.com/en-us/bingwebmaster/>
- Cloudflare DNS 代理说明：<https://developers.cloudflare.com/dns/proxy-status/>
- GitHub Container Registry 与 Docker Actions：<https://docs.github.com/actions/use-cases-and-examples/publishing-packages/publishing-docker-images>

---

## 18. CC 最终回报格式

完成后按以下格式回报，不要只说“完成了”：

```text
1. 已完成模块
2. 未完成模块及原因
3. 技术架构与关键决策
4. 仓库目录
5. 本地启动命令
6. Docker 启动和验证结果
7. 测试命令及通过数量
8. GHCR 镜像名称与触发规则
9. 生产部署步骤
10. Cloudflare 需要人工配置的项目
11. 默认管理员创建方式
12. 已知限制
13. 下一步建议
```

如在实现中发现本规格存在冲突，优先级为：

```text
安全与租户隔离
> 数据真实性
> SEO 闭环完整性
> API 稳定性
> 可部署性
> 界面装饰
```

不要为了赶进度牺牲安全边界，也不要用假数据假装第三方集成已经成功。
