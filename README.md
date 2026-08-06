# RankLoop SEO

SEO 全生命周期管理平台。平台托管内容并执行 SEO 规则检测，第三方通过 API 提交内容、
获取不合格项、自行优化后重新提交，达标才允许发布。

**平台不介入 AI，不生成内容**——只提供接口与判定，优化由第三方自行完成。

## 闭环

```text
第三方 POST 内容
  → 平台跑 SEO 规则
  → 返回不合格项（规则编码 + 证据 + 修复建议）
  → 第三方自行优化后 PUT 更新
  → 重新检测（可多轮迭代）
  → 达标 → publish（存在 critical 问题时拒绝）
```

## 功能范围

已实现：

- 内容托管 CRUD，支持 HTML 与 Markdown 两种格式
- 16 条 SEO 规则，分 critical / warning / notice 三级
- 可解释健康分（按规则权重扣分，可追溯每一分的来源）
- 发布门槛：critical 问题阻断发布
- 无状态预检接口（不落库，供发布前反复试算）
- API Key 认证与 scope 授权
- 多租户隔离
- Docker 一键部署

明确不做（第一版）：

- 不接入生成式 AI，不生成文章与 SEO 文案
- 不承诺"保证收录"或"强制排名"
- 不实现黑帽 SEO

尚未实现（二期）：

- 外部站点抓取与 SSRF 防护
- 网站所有权验证
- IndexNow 实际提交
- Google Search Console 集成
- Web 管理面板

详见 [docs/ADR-001-内容托管闭环.md](docs/ADR-001-内容托管闭环.md)。

## 快速开始

```bash
cp .env.example .env

# 必须替换为随机值，否则生产模式启动会直接失败
openssl rand -base64 32   # 填入 SESSION_SECRET
openssl rand -base64 32   # 填入 ENCRYPTION_KEY

docker compose up -d --build
```

启动后：

```bash
curl http://127.0.0.1:8080/health/ready
```

创建工作区、站点与 API Key（明文 Key 只显示一次）：

```bash
docker compose exec api node /app/seed.mjs
```

## 本地开发

```bash
npm ci
npm run generate     # 生成 Prisma Client，typecheck 依赖它
npm test
npm run build
```

## API

统一前缀 `/api/v1`，认证方式：

```http
Authorization: Bearer rkl_live_xxxxxxxx
```

| 方法 | 路径 | scope | 说明 |
| --- | --- | --- | --- |
| GET | `/rules` | 公开 | 规则清单与权重 |
| POST | `/sites/:siteId/contents` | `contents:write` | 提交内容并检测 |
| GET | `/sites/:siteId/contents` | `contents:read` | 列出站点内容 |
| GET | `/contents/:contentId` | `contents:read` | 查看内容与最新检测 |
| PUT | `/contents/:contentId` | `contents:write` | 更新内容，产生新版本 |
| POST | `/contents/check` | `contents:write` | 无状态预检，不落库 |
| POST | `/contents/:contentId/publish` | `contents:publish` | 发布，critical 时返回 422 |

响应格式见 `docs/RankLoop-SEO-项目完整.md` §7.3。

### 示例：提交 → 修复 → 发布

```bash
KEY=rkl_live_xxx
SITE=<site_id>

# 提交（缺 title，会被判 critical）
curl -X POST "http://127.0.0.1:8080/api/v1/sites/$SITE/contents" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"path":"/article","format":"markdown","body":"# 标题\n\n短"}'
# → score 13，critical: MISSING_TITLE / EMPTY_CONTENT

# 发布会被拦截
curl -X POST "http://127.0.0.1:8080/api/v1/contents/<id>/publish" \
  -H "Authorization: Bearer $KEY"
# → 422 SEO_GATE_FAILED，details.blocking 列出阻塞规则

# 修复后更新 → score 90，publishable: true → 再次发布返回 200
```

### Markdown 元数据

Markdown 内容的 title / description / canonical 等元数据通过 frontmatter 提供：

```markdown
---
title: 如何优化网站的搜索引擎排名完整指南
description: 本文详细介绍网站 SEO 优化的核心方法……
canonical: https://example.com/article
lang: zh-CN
og:
  title: SEO 指南
  description: 完整指南
---

# 正文标题
```

平台负责渲染并生成 `<head>`，因此 HTML 与 Markdown 跑同一套规则、得到一致结论
（有测试保证等价性，第三方无法通过切换格式绕过门槛）。

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

## 数据库迁移

```bash
# 生产：compose 中由独立的 migrate 服务执行，避免多实例并发迁移
docker compose run --rm migrate

# 开发
npx prisma migrate dev --schema packages/db/prisma/schema.prisma
```

## 镜像

GitHub Actions 自动构建并推送到 GHCR：

```text
ghcr.io/lordfoxfairy/rankloop:main          # main 分支
ghcr.io/lordfoxfairy/rankloop:v1.2.3        # 版本标签
ghcr.io/lordfoxfairy/rankloop:latest        # 正式 tag
ghcr.io/lordfoxfairy/rankloop:sha-abc1234   # 单次提交
```

支持 `linux/amd64` 与 `linux/arm64`。

部署与升级见 [DEPLOY.md](DEPLOY.md)。

## 安全

- API Key 只存 SHA-256 哈希，明文仅创建时返回一次
- 跨租户访问返回 404 而非 403，避免泄露资源是否存在
- 内容路径阻断 `..` 与编码绕过
- Webhook 签名覆盖时间戳，防重放
- 容器以非 root 用户运行，数据库与 Redis 不映射公网
- 生产模式使用示例密钥直接拒绝启动

发现安全问题请通过 GitHub Issue 私下联系维护者。

## 已知限制

- 二期功能（爬虫、IndexNow 提交、GSC 集成、Web 面板）尚未实现
- 尚无 Web 界面，当前仅提供 API
- 托管内容的最终投递目标尚未确定，已通过抽象隔离以避免返工

## License

[MIT](LICENSE)
