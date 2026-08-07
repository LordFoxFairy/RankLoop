# 部署指南

## 链路

```text
GitHub 仓库 → GitHub Actions 构建 → GHCR 镜像
  → 服务器 Docker Compose → Nginx/1Panel 反代 → Cloudflare DNS → 用户
```

**关于 Cloudflare**：它不运行本项目的容器。Workers 是 V8 isolate，
无法运行 Docker 镜像，也无法直连 PostgreSQL。Cloudflare 负责
DNS、边缘证书、缓存与 WAF，应用始终跑在你自己的服务器上。

## 一键部署

### 1. 服务器准备

```bash
git clone https://github.com/LordFoxFairy/RankLoop.git
cd RankLoop
cp .env.example .env
```

生成随机密钥填入 `.env`（**必须替换**，否则生产模式拒绝启动）：

```bash
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -hex 16      # POSTGRES_PASSWORD
```

同时把 `APP_URL` 改成实际域名。

### 2. 部署

```bash
./infra/scripts/deploy.sh
```

脚本会：拉取镜像 → 执行迁移 → 启动服务 → 等待健康检查 →
**失败时自动回滚到上一个镜像**。

部署指定版本：

```bash
./infra/scripts/deploy.sh v1.2.3
```

### 3. 创建初始工作区与 API Key

```bash
docker compose exec api node /app/seed.mjs
```

输出的 `api_key` **只显示一次**，请立即保存。

### 4. Cloudflare 配置

需要一个具备 `Zone:DNS:Edit`、`Zone:Zone Settings:Edit`、
`Zone:Cache Rules:Edit` 权限的 API Token：

```bash
CF_API_TOKEN=xxx SERVER_IP=1.2.3.4 \
  ./infra/scripts/cloudflare-setup.sh rankloop.miaokit.cloud
```

脚本会配置：A 记录（开启代理）、SSL Full (strict)、
Always Use HTTPS、`/api/*` 与面板绕过缓存。

**`/api/*` 绝不能缓存**——响应带授权头且因 API Key 而异，
缓存会导致跨租户数据泄露。

仍需人工完成：

1. 源站安装 Cloudflare Origin Certificate
   （控制台 → SSL/TLS → Origin Server → Create Certificate）
2. 防火墙只开放 80/443
3. 确认反代已转发到 `127.0.0.1:8080`

## 反向代理

API 只监听 `127.0.0.1:8080`，不直接对外。Nginx 示例：

```nginx
server {
    listen 443 ssl http2;
    server_name rankloop.miaokit.cloud;

    ssl_certificate     /path/to/cloudflare-origin.pem;
    ssl_certificate_key /path/to/cloudflare-origin.key;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

使用 1Panel 时，在面板中反代到 `127.0.0.1:8080` 即可。

## 升级与回滚

```bash
./infra/scripts/deploy.sh          # 升级到最新 main
./infra/scripts/deploy.sh v1.2.0   # 回滚到指定版本
```

`deploy.sh` 在健康检查失败时会自动回滚，无需手动干预。
迁移由独立的 `migrate` 服务执行，API 等待其成功后才启动，
因此多实例部署不会并发迁移。

## 备份与恢复

```bash
# 备份
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > backup-$(date +%Y%m%d).sql.gz

# 恢复
gunzip -c backup-20260806.sql.gz \
  | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

建议配置每日 cron 备份并异地保存。

## 运维检查

| 项目 | 命令 |
| --- | --- |
| 存活探针 | `curl http://127.0.0.1:8080/health/live` |
| 就绪探针 | `curl http://127.0.0.1:8080/health/ready` |
| 服务状态 | `docker compose ps` |
| 日志 | `docker compose logs -f api` |
| 可视化面板 | 浏览器打开 `https://<域名>/` |

日志已配置轮转（单文件 10MB，保留 3 份）。

## 验证部署是否生效

```bash
# 1. 健康检查
curl https://rankloop.miaokit.cloud/health/ready

# 2. 规则接口（公开）
curl https://rankloop.miaokit.cloud/api/v1/rules | head

# 3. 面板（浏览器打开，粘贴 API Key）
open https://rankloop.miaokit.cloud/
```

## 关于 Google SEO 验证

平台生成的 sitemap 位于 `/api/v1/sites/:siteId/sitemap.xml`。
要让 Google 收录托管内容：

1. 把 sitemap 内容发布到站点根目录的 `/sitemap.xml`
2. 在 `/robots.txt` 中声明 sitemap 位置（平台提供生成接口）
3. 在 Google Search Console 提交 sitemap
4. 用 `site:你的域名` 检查收录情况

**没有任何工具能强制 Google 收录**。平台的作用是拦截会导致
不被收录的问题（noindex、缺 title、canonical 跨域等），并加快发现。

IndexNow 通知的是 Bing / Yandex / Seznam / Naver，**Google 不支持该协议**。

## 自动部署（可选）

第一版默认不提供 CI 自动部署到服务器。若需要，可添加受保护的
`deploy-production.yml`，但必须配置 GitHub Environment 与审批规则，
**不得把生产 SSH 私钥写进仓库**。
