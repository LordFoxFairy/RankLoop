# 部署指南

## 链路

```text
GitHub 仓库 → GitHub Actions 构建 → GHCR 镜像
  → 服务器 Docker Compose → Nginx/1Panel 反代 → Cloudflare DNS → 用户
```

Cloudflare 不直接运行本项目镜像，只负责 DNS、边缘证书、缓存与 WAF。

## 首次部署

### 1. 准备环境

```bash
git clone https://github.com/LordFoxFairy/RankLoop.git
cd RankLoop
cp .env.example .env
```

### 2. 生成密钥

**必须替换**，否则生产模式启动会直接失败：

```bash
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -hex 16      # POSTGRES_PASSWORD
```

同时把 `APP_URL` 改成实际域名。

### 3. 启动

```bash
docker compose up -d --build
docker compose ps          # 三个服务应为 healthy
curl http://127.0.0.1:8080/health/ready
```

迁移由独立的 `migrate` 服务执行，API 会等待其成功后再启动，
因此多实例部署不会并发迁移。

### 4. 创建初始工作区与 API Key

```bash
docker compose exec api node /app/seed.mjs
```

输出的 `api_key` **只显示一次**，请立即保存。

## 反向代理

API 只监听 `127.0.0.1:8080`，不直接对外。Nginx 示例：

```nginx
server {
    listen 443 ssl http2;
    server_name seo.example.com;

    ssl_certificate     /path/to/cloudflare-origin.pem;
    ssl_certificate_key /path/to/cloudflare-origin.key;

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

使用 1Panel 时，在面板中反代到 `127.0.0.1:8080` 即可，无需额外配置。

## Cloudflare

需要人工配置的项目：

1. 添加 A/AAAA 记录指向服务器 IP，开启代理（橙色云）
2. SSL/TLS 模式设为 **Full (strict)**
3. 源站安装 Cloudflare Origin Certificate
4. 缓存规则：`/api/*` 绕过缓存（含授权头的响应不得缓存）
5. 防火墙只开放 80/443，数据库端口不对外

## 升级

```bash
docker compose pull
docker compose up -d
```

镜像更新后 `migrate` 服务会自动执行新迁移。升级前建议先备份。

回滚到上一版本：

```bash
docker compose down
# 修改 compose.yaml 中的镜像标签为上一个 sha-xxxxxxx 或版本号
docker compose up -d
```

GHCR 至少保留一个可回滚版本，标签格式见 README。

## 备份与恢复

备份数据库：

```bash
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > backup-$(date +%Y%m%d).sql.gz
```

恢复：

```bash
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

日志已配置轮转（单文件 10MB，保留 3 份），不会撑爆磁盘。

## 自动部署

第一版不提供自动部署。若需要，可自行添加受保护的
`deploy-production.yml`，但必须配置 GitHub Environment 与审批规则，
**不得把生产 SSH 私钥写进仓库**。
