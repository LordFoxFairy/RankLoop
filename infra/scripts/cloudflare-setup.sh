#!/usr/bin/env bash
#
# Cloudflare 配置：DNS 记录 + SSL 模式 + 缓存规则。
#
# 重要：Cloudflare 不运行本项目的容器（Workers 是 V8 isolate，
# 无法运行 Docker 镜像，也不能直连 PostgreSQL）。
# 它只负责 DNS、边缘证书、缓存与 WAF —— 应用仍跑在你自己的服务器上。
#
# 需要一个具备以下权限的 API Token：
#   Zone:DNS:Edit、Zone:Zone Settings:Edit、Zone:Cache Rules:Edit
#
# 用法：
#   CF_API_TOKEN=xxx SERVER_IP=1.2.3.4 ./infra/scripts/cloudflare-setup.sh seo.miaokit.cloud
set -Eeuo pipefail

HOSTNAME="${1:?用法: $0 <hostname>，例如 seo.miaokit.cloud}"
: "${CF_API_TOKEN:?需要设置 CF_API_TOKEN}"
: "${SERVER_IP:?需要设置 SERVER_IP（源站服务器公网 IP）}"

API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json")

log() { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok()  { printf '\033[32m✓\033[0m %s\n' "$*"; }
err() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }

# 从主机名推出根域名（seo.miaokit.cloud → miaokit.cloud）
ROOT_DOMAIN="$(echo "$HOSTNAME" | awk -F. '{print $(NF-1)"."$NF}')"

check() {
  # Cloudflare 即使失败也返回 HTTP 200，必须检查 success 字段
  python3 -c "
import json,sys
d=json.load(sys.stdin)
if not d.get('success'):
    print(json.dumps(d.get('errors',[]),ensure_ascii=False),file=sys.stderr); sys.exit(1)
print(json.dumps(d.get('result')))
"
}

log "查找 Zone：${ROOT_DOMAIN}"
ZONE_ID="$(curl -sS "${AUTH[@]}" "${API}/zones?name=${ROOT_DOMAIN}" | check |
  python3 -c "import json,sys;r=json.load(sys.stdin);print(r[0]['id'] if r else '')")"
[ -n "$ZONE_ID" ] || { err "未找到 Zone ${ROOT_DOMAIN}，请确认域名已托管在此账号下"; exit 1; }
ok "Zone: ${ZONE_ID}"

log "配置 A 记录 ${HOSTNAME} → ${SERVER_IP}（开启代理）"
EXISTING="$(curl -sS "${AUTH[@]}" "${API}/zones/${ZONE_ID}/dns_records?type=A&name=${HOSTNAME}" | check |
  python3 -c "import json,sys;r=json.load(sys.stdin);print(r[0]['id'] if r else '')")"

RECORD='{"type":"A","name":"'"${HOSTNAME}"'","content":"'"${SERVER_IP}"'","proxied":true,"ttl":1}'
if [ -n "$EXISTING" ]; then
  curl -sS -X PUT "${AUTH[@]}" "${API}/zones/${ZONE_ID}/dns_records/${EXISTING}" -d "$RECORD" | check >/dev/null
  ok "A 记录已更新"
else
  curl -sS -X POST "${AUTH[@]}" "${API}/zones/${ZONE_ID}/dns_records" -d "$RECORD" | check >/dev/null
  ok "A 记录已创建"
fi

# Full (strict)：边缘到源站也校验证书，避免中间人（规格 §12.3）
log "设置 SSL 模式为 Full (strict)"
curl -sS -X PATCH "${AUTH[@]}" "${API}/zones/${ZONE_ID}/settings/ssl" \
  -d '{"value":"strict"}' | check >/dev/null && ok "SSL: Full (strict)"

log "启用 Always Use HTTPS"
curl -sS -X PATCH "${AUTH[@]}" "${API}/zones/${ZONE_ID}/settings/always_use_https" \
  -d '{"value":"on"}' | check >/dev/null && ok "Always Use HTTPS 已启用"

# /api/* 绝不能缓存：响应带授权头且因 Key 而异，缓存会导致跨租户数据泄露
log "配置缓存规则：/api/* 与面板绕过缓存"
RULESET="$(curl -sS "${AUTH[@]}" \
  "${API}/zones/${ZONE_ID}/rulesets/phases/http_request_cache_settings/entrypoint" 2>/dev/null |
  python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('result',{}).get('id','') if d.get('success') else '')" 2>/dev/null || echo '')"

RULES='{"rules":[{
  "expression":"(http.host eq \"'"${HOSTNAME}"'\" and (starts_with(http.request.uri.path, \"/api/\") or http.request.uri.path eq \"/\"))",
  "action":"set_cache_settings",
  "action_parameters":{"cache":false},
  "description":"RankLoop: API 与面板不缓存"
}]}'

if [ -n "$RULESET" ]; then
  curl -sS -X PUT "${AUTH[@]}" "${API}/zones/${ZONE_ID}/rulesets/${RULESET}" -d "$RULES" | check >/dev/null &&
    ok "缓存规则已更新"
else
  curl -sS -X PUT "${AUTH[@]}" \
    "${API}/zones/${ZONE_ID}/rulesets/phases/http_request_cache_settings/entrypoint" \
    -d "$RULES" | check >/dev/null && ok "缓存规则已创建"
fi

echo
ok "Cloudflare 配置完成：https://${HOSTNAME}"
cat <<EOF

仍需人工完成：
  1. 源站安装 Cloudflare Origin Certificate（Full strict 要求源站证书可信）
     控制台 → SSL/TLS → Origin Server → Create Certificate
  2. 服务器防火墙只开放 80/443
  3. 确认反代已将 /api/* 与 / 转发到 127.0.0.1:8080

验证：
  curl -I https://${HOSTNAME}/health/live
EOF
