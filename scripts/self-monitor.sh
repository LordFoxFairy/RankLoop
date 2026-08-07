#!/usr/bin/env bash
# 把 RankLoop 官网自己的页面送进 RankLoop 检测。
#
# 为什么需要：做 SEO 工具却不检测自己没有说服力。更实际的原因是，
# 导入的内容是快照，官网更新后平台里的副本就过期了——本次就发现
# 平台里存的 /rules 还写着 24 条，实际已有 29 条。
#
# 幂等：已存在的 path 走更新，不存在的才创建。可放进 cron 定期跑。
#
#   RANKLOOP_KEY=rkl_live_xxx RANKLOOP_SITE=<siteId> bash scripts/self-monitor.sh
set -euo pipefail

API="${RANKLOOP_API:-https://app.miaokit.cloud/api/v1}"
KEY="${RANKLOOP_KEY:?需要 RANKLOOP_KEY}"
SITE="${RANKLOOP_SITE:?需要 RANKLOOP_SITE}"
SOURCE="${SOURCE_ORIGIN:-https://rankloop.pages.dev}"

PATHS=(/ /docs /skills /rules /getting-started /why-not-indexed /publish-gate)

# 先取一次现有内容，避免每个 path 都查一遍
EXISTING="$(curl -s "$API/sites/$SITE/contents?limit=50" -H "authorization: Bearer $KEY")"

for p in "${PATHS[@]}"; do
  # 源站用带尾斜杠的目录形式，平台里存不带斜杠的规范路径
  src="$p"; [ "$p" != "/" ] && src="$p/"
  html="$(curl -s --max-time 30 "$SOURCE$src")"
  if [ -z "$html" ]; then
    echo "  跳过 $p（源站无响应）" >&2
    continue
  fi

  cid="$(printf '%s' "$EXISTING" | PATHV="$p" python3 -c "
import json,os,sys
target=os.environ['PATHV']
for c in json.load(sys.stdin)['data']:
    if c['path']==target: print(c['id']); break")"

  body="$(printf '%s' "$html" | python3 -c "
import json,sys
print(json.dumps({'format':'html','body':sys.stdin.read()}))")"

  if [ -n "$cid" ]; then
    code="$(curl -s -X PUT "$API/contents/$cid" -H "authorization: Bearer $KEY" \
      -H 'content-type: application/json' -d "$body" -o /dev/null -w '%{http_code}')"
    action=更新
  else
    body="$(printf '%s' "$html" | PATHV="$p" python3 -c "
import json,os,sys
print(json.dumps({'path':os.environ['PATHV'],'format':'html','body':sys.stdin.read()}))")"
    cid="$(curl -s -X POST "$API/sites/$SITE/contents" -H "authorization: Bearer $KEY" \
      -H 'content-type: application/json' -d "$body" \
      | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('id',''))")"
    code=201; action=新建
  fi

  # 发布：未通过门槛会返回 422，此时如实报告而非静默跳过
  pub="$(curl -s -X POST "$API/contents/$cid/publish" -H "authorization: Bearer $KEY" \
    -o /dev/null -w '%{http_code}')"
  echo "  $action $p → $code，发布 → $pub"
done

echo
echo "各页面得分："
curl -s "$API/sites/$SITE/contents?limit=50" -H "authorization: Bearer $KEY" | python3 -c "
import json,sys
for c in sorted(json.load(sys.stdin)['data'], key=lambda x: x['path']):
    flag = '✗' if c.get('blocking_count') else '✓'
    print('  %s %-20s %s 分' % (flag, c['path'], c['score']))"
