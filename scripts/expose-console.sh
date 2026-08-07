#!/usr/bin/env bash
# 把本地控制台临时暴露到公网。
#
# 用途：还没部署到 Render 时，想在手机或别的设备上打开控制台。
# 不需要任何账号——Cloudflare Quick Tunnel 直接分配一个随机公网地址。
#
# 局限：进程停止或电脑关机链接即失效，地址每次重启都会变。
# 长期在线请用 render.yaml 部署（见 DEPLOY.md）。
#
#   bash scripts/expose-console.sh
set -euo pipefail

PORT="${PORT:-8080}"
LOG="$(mktemp -t rankloop-tunnel)"

if ! curl -fsS --max-time 5 "http://localhost:$PORT/health/live" >/dev/null 2>&1; then
  echo "本地服务未在 localhost:$PORT 运行，请先执行：docker compose up -d" >&2
  exit 1
fi

echo "正在建立公网隧道…"
npx --yes cloudflared@latest tunnel --url "http://localhost:$PORT" >"$LOG" 2>&1 &
TUNNEL_PID=$!
# 进程退出时一并关掉隧道，避免留下孤儿进程占用端口
trap 'kill $TUNNEL_PID 2>/dev/null || true' EXIT

# 地址在日志里异步出现，轮询等待而非固定 sleep
for _ in $(seq 1 40); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 2
done

if [ -z "${URL:-}" ]; then
  echo "隧道建立失败，日志：$LOG" >&2
  exit 1
fi

cat <<EOF

  控制台：$URL/console
  接口：  $URL/api/v1

  账号密码见 compose.yaml 中的 INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD。

  按 Ctrl+C 结束隧道。地址仅在本进程运行期间有效。

EOF

wait $TUNNEL_PID
