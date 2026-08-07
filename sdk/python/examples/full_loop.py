"""完整闭环示例：提交 → 被拦 → 按建议修 → 发布。

    RANKLOOP_BASE_URL=http://localhost:8080/api/v1 \
    RANKLOOP_API_KEY=rkl_live_xxx \
    RANKLOOP_SITE_ID=xxx python examples/full_loop.py
"""

import os
import uuid

from rankloop import Client

client = Client(
    api_key=os.environ["RANKLOOP_API_KEY"],
    base_url=os.environ.get("RANKLOOP_BASE_URL", "https://rankloop.miaokit.cloud/api/v1"),
)
site_id = os.environ["RANKLOOP_SITE_ID"]

# 一篇有问题的内容：没标题、没正文
draft = "<html><body><p>草稿</p></body></html>"

path = f"/example-{uuid.uuid4().hex[:8]}"
content = client.submit(site_id, path=path, body=draft)
print(f"已提交 {path}")

ok, todo = client.publish_when_ready(content.id)
if ok:
    print("直接发布成功")
    raise SystemExit(0)

print(f"\n发不出去，必须先修 {len(todo)} 项：")
for r in todo:
    print(f"  [{r.code}] {r.message}")
    print(f"      建议：{r.recommendation}")
    print(f"      预估：{r.minutes} 分钟，+{r.gain} 分")

items, impact = client.recommendations(content.id)
print(f"\n当前 {impact.current} 分 → 全修完 {impact.potential} 分")
print(f"只做快速项：{impact.quick_minutes} 分钟到 {impact.quick_win} 分")

# 修好后重新提交
fixed = (
    '<html lang="zh"><head><title>修复之后的示例文章标题</title>'
    '<meta name="description" content="这是一段长度合适的页面描述文本，'
    '用于通过描述相关的检测规则，确保内容能够正常发布出去。"></head>'
    "<body><h1>修复之后的示例文章标题</h1><p>"
    + "这是补充的正文内容，需要足够长以避免触发内容过短的检测规则。" * 12
    + "</p></body></html>"
)
client.update(content.id, body=fixed)
print("\n已按建议修复并重新提交")

ok, todo = client.publish_when_ready(content.id)
print("发布成功" if ok else f"仍无法发布：{[r.code for r in todo]}")
