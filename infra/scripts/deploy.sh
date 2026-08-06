#!/usr/bin/env bash
#
# 一键部署：拉取最新镜像 → 迁移 → 启动 → 健康校验 → 失败自动回滚。
#
# 在服务器上执行。首次部署前需先准备 .env（见 DEPLOY.md）。
#
# 用法：
#   ./infra/scripts/deploy.sh              # 部署 main 标签
#   ./infra/scripts/deploy.sh v1.2.3       # 部署指定版本
set -Eeuo pipefail

TAG="${1:-main}"
IMAGE="ghcr.io/lordfoxfairy/rankloop"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8080/health/ready}"
TIMEOUT="${HEALTH_TIMEOUT:-90}"

cd "$(dirname "$0")/../.."

log() { printf '\033[36m▸\033[0m %s\n' "$*"; }
err() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }
ok()  { printf '\033[32m✓\033[0m %s\n' "$*"; }

[ -f .env ] || { err ".env 不存在，请先 cp .env.example .env 并填入随机密钥"; exit 1; }

# 生产环境使用示例密钥会导致容器启动失败，提前拦截给出清晰提示
if grep -qE '^(SESSION_SECRET|ENCRYPTION_KEY)=change-' .env; then
  err ".env 仍使用示例密钥，请先替换："
  err "  openssl rand -base64 32"
  exit 1
fi

# 记录当前镜像 digest，失败时回滚到它
PREVIOUS="$(docker inspect --format='{{index .RepoDigests 0}}' "${IMAGE}:${TAG}" 2>/dev/null || echo '')"
[ -n "$PREVIOUS" ] && log "当前版本：${PREVIOUS##*@}"

log "拉取 ${IMAGE}:${TAG}"
RANKLOOP_TAG="$TAG" docker compose pull

log "执行数据库迁移"
RANKLOOP_TAG="$TAG" docker compose run --rm migrate

log "启动服务"
RANKLOOP_TAG="$TAG" docker compose up -d

log "等待健康检查（最多 ${TIMEOUT}s）"
deadline=$(( $(date +%s) + TIMEOUT ))
until curl -fsS "$HEALTH_URL" >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    err "健康检查超时，最近日志："
    docker compose logs --tail 40 api >&2

    if [ -n "$PREVIOUS" ]; then
      err "回滚到 ${PREVIOUS##*@}"
      docker tag "$PREVIOUS" "${IMAGE}:${TAG}"
      docker compose up -d
    fi
    exit 1
  fi
  sleep 3
done

ok "部署成功"
curl -fsS "$HEALTH_URL"
echo
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
