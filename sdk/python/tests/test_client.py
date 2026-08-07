"""SDK 测试。

对着真实运行的 API 跑，而不是 mock——mock 只能证明 SDK 自洽，
证明不了它和服务端对得上。字段改名这类问题只有真请求才发现得了。

    RANKLOOP_BASE_URL=http://localhost:8080/api/v1 \
    RANKLOOP_API_KEY=rkl_live_xxx \
    RANKLOOP_SITE_ID=xxx pytest
"""

from __future__ import annotations

import os
import uuid

import pytest

from rankloop import Client, PublishBlockedError
from rankloop.errors import AuthError, NotFoundError

BASE_URL = os.environ.get("RANKLOOP_BASE_URL")
API_KEY = os.environ.get("RANKLOOP_API_KEY")
SITE_ID = os.environ.get("RANKLOOP_SITE_ID")

live = pytest.mark.skipif(
    not (BASE_URL and API_KEY and SITE_ID),
    reason="需要 RANKLOOP_BASE_URL / RANKLOOP_API_KEY / RANKLOOP_SITE_ID",
)

GOOD_BODY = (
    '<html lang="zh"><head><title>SDK 集成测试用的示例文章标题</title>'
    '<meta name="description" content="这是一段长度合适的页面描述文本，'
    '用于通过描述相关的检测规则，确保内容能够正常发布出去。">'
    '<meta property="og:title" content="SDK 集成测试用的示例文章标题">'
    '<meta property="og:description" content="这是一段长度合适的页面描述文本。">'
    "</head><body><h1>SDK 集成测试用的示例文章标题</h1><p>"
    + "这是一段用于集成测试的正文内容，需要足够长以避免触发内容过短的检测规则。" * 12
    + "</p></body></html>"
)

BAD_BODY = "<html><body></body></html>"


def make_client() -> Client:
    return Client(api_key=API_KEY, base_url=BASE_URL)


def test_api_key_required():
    """空密钥要在构造时就报错，而不是等到发请求。"""
    with pytest.raises(ValueError):
        Client(api_key="")


@live
def test_check_detects_problems():
    """预检能查出问题，且不落库。"""
    r = make_client().check(body=BAD_BODY, url="https://x.example.org/a")

    assert r.score < 50
    assert r.publishable is False
    assert any(i.code == "MISSING_TITLE" for i in r.issues)
    # 阻断项要能单独取出来，这是调用方最常用的
    assert all(i.severity == "critical" for i in r.blocking_issues)


@live
def test_check_passes_good_content():
    r = make_client().check(body=GOOD_BODY, url="https://x.example.org/ok")
    assert r.publishable is True
    assert not r.blocking_issues


@live
def test_publish_blocked_raises_with_details():
    """被门槛拦截时要抛出可直接读的清单，而不是让调用方解析 JSON。"""
    client = make_client()
    path = f"/sdk-bad-{uuid.uuid4().hex[:8]}"
    content = client.submit(SITE_ID, path=path, body=BAD_BODY)

    with pytest.raises(PublishBlockedError) as e:
        client.publish(content.id)

    assert "MISSING_TITLE" in e.value.blocking
    assert e.value.score >= 0


@live
def test_full_loop_submit_fix_publish():
    """完整闭环：提交 → 被拦 → 按建议修 → 发布成功。"""
    client = make_client()
    path = f"/sdk-loop-{uuid.uuid4().hex[:8]}"

    content = client.submit(SITE_ID, path=path, body=BAD_BODY)
    ok, todo = client.publish_when_ready(content.id)
    assert ok is False
    assert todo, "应当给出待修复项"

    client.update(content.id, body=GOOD_BODY)
    ok, todo = client.publish_when_ready(content.id)
    assert ok is True, f"修复后仍无法发布：{todo}"


@live
def test_recommendations_sorted_by_value():
    """建议按性价比排序，阻断项在最前。"""
    client = make_client()
    path = f"/sdk-rec-{uuid.uuid4().hex[:8]}"
    content = client.submit(SITE_ID, path=path, body=BAD_BODY)

    items, impact = client.recommendations(content.id)
    assert items

    # 阻断项必须排在非阻断项之前
    blocking_idx = [n for n, i in enumerate(items) if i.blocking]
    normal_idx = [n for n, i in enumerate(items) if not i.blocking]
    if blocking_idx and normal_idx:
        assert max(blocking_idx) < min(normal_idx)

    assert impact.potential >= impact.current
    assert impact.blocking_count == len(blocking_idx)


@live
def test_invalid_key_raises_auth_error():
    client = Client(api_key="rkl_live_invalid", base_url=BASE_URL)
    with pytest.raises(AuthError):
        client.check(body=GOOD_BODY, url="https://x.example.org/a")


@live
def test_unknown_content_raises_not_found():
    client = make_client()
    with pytest.raises(NotFoundError):
        client.get("00000000-0000-0000-0000-000000000000")


@live
def test_rules_listed():
    rules = make_client().rules()
    assert len(rules) > 10
    assert all("code" in r and "weight" in r for r in rules)
