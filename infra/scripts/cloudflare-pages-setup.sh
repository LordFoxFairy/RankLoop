#!/usr/bin/env bash
#
# 创建 Cloudflare Pages 项目并做首次部署。
#
# Cloudflare Pages 免费版：每月 500 次构建、100 个自定义域名、20000 个文件。
# 不需要 Docker，不需要服务器；可绑根域名，因此没有 GitHub Pages 的子路径问题。
#
# 需要一个具备 "Cloudflare Pages:Edit" 权限的 API Token：
#   https://dash.cloudflare.com/profile/api-tokens
#
# 用法：
#   CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=yyy \
#     ./infra/scripts/cloudflare-pages-setup.sh [项目名] [站点地址]
set -Eeuo pipefail

PROJECT="${1:-rankloop}"
SITE_URL="${2:-https://${PROJECT}.pages.dev}"
: "${CLOUDFLARE_API_TOKEN:?需要设置 CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?需要设置 CLOUDFLARE_ACCOUNT_ID}"

cd "$(dirname "$0")/../.."

log() { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok()  { printf '\033[32m✓\033[0m %s\n' "$*"; }
err() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }

API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects"
AUTH=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json")

log "检查项目 ${PROJECT}"
EXISTS="$(curl -sS "${AUTH[@]}" "${API}/${PROJECT}" |
  python3 -c "import json,sys; print('yes' if json.load(sys.stdin).get('success') else 'no')")"

if [ "$EXISTS" = "no" ]; then
  log "创建 Pages 项目"
  RESULT="$(curl -sS -X POST "${AUTH[@]}" "$API" \
    -d "{\"name\":\"${PROJECT}\",\"production_branch\":\"main\"}")"
  if ! echo "$RESULT" | python3 -c "import json,sys; sys.exit(0 if json.load(sys.stdin).get('success') else 1)"; then
    err "创建失败："
    echo "$RESULT" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin).get('errors'), ensure_ascii=False, indent=2))" >&2
    exit 1
  fi
  ok "项目已创建"
else
  ok "项目已存在"
fi

log "构建站点（SITE_URL=${SITE_URL}）"
npm run build --workspace @rankloop/seo-rules >/dev/null
npm run build --workspace @rankloop/static-site >/dev/null
rm -rf dist-site
SITE_URL="$SITE_URL" node apps/static-site/dist/cli.js

log "部署到 Cloudflare Pages"
npx wrangler@4 pages deploy dist-site --project-name="$PROJECT" --branch=main --commit-dirty=true

echo
ok "部署完成"
cat <<EOF

站点地址：${SITE_URL}
sitemap：${SITE_URL}/sitemap.xml

后续自动部署：在 GitHub 仓库配置
  Secrets:   CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID
  Variables: SITE_URL、CF_PAGES_PROJECT（可选）
之后每次修改 content/ 推送到 main 都会自动构建并部署。

绑定自定义域名：
  Cloudflare 控制台 → Workers & Pages → ${PROJECT} → Custom domains
  绑定后把 SITE_URL 变量改成新域名，重新触发一次部署即可。
EOF
