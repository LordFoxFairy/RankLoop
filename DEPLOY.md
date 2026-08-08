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

## 租户站点域名与证书

租户内容通过 `<slug>.rankloop.<你的域名>` 对外，例如
`acme.rankloop.example.com`。DNS 只需一条通配符：

```
*.rankloop.example.com   A   <服务器 IP>   (DNS-only，不走代理)
```

**不要用一级通配符 `*.example.com`**——它会接管该域名下所有未显式配置的
子域名，你以后新建任何服务在配好 DNS 之前都会被误导向租户渲染。
把租户收拢在 `rankloop.` 命名空间下，代价只是域名长一点。

### 证书

Cloudflare 免费版的通用证书**只覆盖一级子域名**，
`*.rankloop.example.com` 这样的二级通配符会握手失败
（`ERR_SSL_VERSION_OR_CIPHER_MISMATCH`）。用 Let's Encrypt 自行签发：

```bash
curl https://get.acme.sh | sh -s email=you@example.com

# DNS-01 验证需要 Cloudflare API Token（权限：Zone:DNS:Edit）
export CF_Token='<你的 token>'
export CF_Zone_ID='<zone id>'

~/.acme.sh/acme.sh --issue --dns dns_cf \
  -d 'rankloop.example.com' -d '*.rankloop.example.com' \
  --server letsencrypt --keylength ec-256

# 安装到 Nginx 并配置自动续期后重载
~/.acme.sh/acme.sh --install-cert -d rankloop.example.com --ecc \
  --fullchain-file /path/to/ssl/fullchain.pem \
  --key-file /path/to/ssl/privkey.pem \
  --reloadcmd "nginx -s reload"
```

acme.sh 会自动续期，无需人工维护。

DNS 记录必须设为 **DNS-only（灰云）**：走 Cloudflare 代理时边缘会用它自己的
证书，而那张证书不覆盖二级子域名。

### Nginx

```nginx
server {
    listen 443 ssl;
    http2 on;
    # 只匹配 rankloop 命名空间，不要用能匹配所有子域名的正则
    server_name ~^[a-z0-9-]+\.rankloop\.example\.com$;

    ssl_certificate     /path/to/ssl/fullchain.pem;
    ssl_certificate_key /path/to/ssl/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;   # 应用按 Host 决定渲染哪个租户
    }
}
```

`PLATFORM_DOMAIN` 需与之一致（如 `rankloop.example.com`），
应用据此从 Host 解析租户 slug，并生成 canonical 与 sitemap 地址。

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

---

## 营销站手动部署到 Cloudflare Pages

CI 里若未配置 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`，
`deploy-cloudflare.yml` 会跳过部署（日志显示「未配置…跳过部署」）。
在补上 Secrets 之前，可用以下步骤手动发布：

```bash
export SITE_URL=https://rankloop.miaokit.cloud
npm run build --workspace @rankloop/seo-rules
npm run build --workspace @rankloop/static-site
node apps/static-site/dist/cli.js          # 生成 dist-site（含 sitemap/robots）

# Google 验证文件：由 gsc-cli --write-token 生成，需要 GSC_SERVICE_ACCOUNT。
# 若本地无凭据，可从 deploy-site.yml 的构建产物中取出 google*.html 放进 dist-site/。
export GSC_SERVICE_ACCOUNT='<服务账号 JSON>'
node apps/static-site/dist/gsc-cli.js --write-token

npx wrangler@4 pages deploy dist-site --project-name=rankloop --branch=main
```

**易漏的一步**：`google<...>.html` 验证文件必须随站点一起部署，
否则 Search Console 会报 `The necessary verification token could not be found on your site`，
sitemap 提交随之失败。

### 自定义域名

DNS 需要一条指向 Pages 的 CNAME（Cloudflare 代理开启）：

```
rankloop.miaokit.cloud  CNAME  rankloop.pages.dev   (proxied)
```

并在 Pages 项目里绑定该域名。两者缺一，域名都无法访问。

### 排查提示

本机 `dig` 若返回 `198.18.x.x`，那是本地 VPN/代理拦截了 DNS，
不是配置问题——该网段是保留的测试网段。用公共 DoH 验证真实解析：

```bash
curl -s -H "accept: application/dns-json" \
  "https://dns.google/resolve?name=rankloop.miaokit.cloud&type=A"
```

---

## 为什么 API 不能放在 Cloudflare

Cloudflare Pages 只托管静态文件，跑不了 PostgreSQL、Redis 与常驻 worker。

Containers 于 2026-04 正式可用，也支持 Docker Hub 镜像，但官方定价表明确写着
**Free 层的 Memory / CPU / Disk 均为 N/A** —— 即容器功能需要 $5/月的
Workers Paid 计划（含 25 GiB-hours 内存、375 vCPU-分钟）。
核实于 2026-08-07：https://developers.cloudflare.com/workers/platform/pricing/

因此完全免费的路径是下面的 Render 蓝图；若愿意付 $5/月，
Cloudflare Containers 也可行（镜像已在 `ghcr.io/lordfoxfairy/rankloop`）。

## 把完整 API 部署到公网（Render 一键蓝图）

Cloudflare Pages 只托管静态站，跑不了 PostgreSQL 与常驻 worker，
因此完整闭环（发布门槛、webhook 投递、面板数据）需要一个能跑容器的地方。
仓库根目录的 `render.yaml` 已把资源编排好，无需手写配置。

### 步骤

1. 注册 https://render.com（免费，GitHub 账号可直接登录）
2. **New → Blueprint** → 选择本仓库 → Render 自动读取 `render.yaml`
3. 只需手填三个值，其余自动生成或互相引用：

   | 变量 | 填什么 |
   |---|---|
   | `APP_URL` | Render 分配的地址，如 `https://rankloop-api.onrender.com` |
   | `INITIAL_ADMIN_EMAIL` | 你的邮箱，用于登录控制台 |
   | `GSC_SERVICE_ACCOUNT` | 可选；填了才会自动同步 Search Console |

4. 部署完成后，在服务的 **Environment** 页查看自动生成的
   `INITIAL_ADMIN_PASSWORD`，用它登录 `<APP_URL>/console`

`DATABASE_URL`、`REDIS_URL` 由 Render 自动注入；
`SESSION_SECRET`、`ENCRYPTION_KEY` 自动生成随机值——
生产环境若使用示例密钥，`lib/env.ts` 会直接拒绝启动。

### 免费层的限制（如实说明）

- Web Service 闲置 15 分钟休眠，首次请求约需 30 秒唤醒
- 免费 PostgreSQL 有效期 90 天，到期需迁移或升级
- 正式对外服务请升级到付费实例

**数据库迁移为什么写在启动命令里**：Render 的 `preDeployCommand`
对 Docker 服务和免费层都不可用，因此 `render.yaml` 把迁移并进
`dockerCommand`（先 `prisma migrate deploy` 再启动服务）。
若改用付费层，可以拆成独立的 pre-deploy 步骤。

### 部署后自检

```bash
export BASE=https://<你的地址>/api/v1
curl -s $BASE/rules | head -c 100                 # 应返回 JSON 规则清单
curl -s -X POST $BASE/auth/login -H 'content-type: application/json' \
  -d '{"email":"<邮箱>","password":"<密码>"}' -o /dev/null -w '%{http_code}\n'   # 200
```

登录后在控制台「租户」页创建租户并签发 API Key，
即可用 Python SDK 跑通完整闭环（见 `sdk/python/README.md`）。
