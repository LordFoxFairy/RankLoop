"""RankLoop Python 客户端。

只用标准库实现（urllib），装了就能用，不引入 requests 等依赖——
客户往往把内容发布嵌在已有系统里，多一个依赖就多一次版本冲突。
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any, Literal

from .errors import (
    AuthError,
    NotFoundError,
    PublishBlockedError,
    QuotaExceededError,
    RankLoopError,
    ValidationError,
)
from .models import CheckResult, Content, Impact, Recommendation

Format = Literal["html", "markdown"]

DEFAULT_BASE_URL = "https://rankloop.miaokit.cloud/api/v1"
#: 遇到 5xx 或网络抖动时的重试次数
DEFAULT_RETRIES = 2
DEFAULT_TIMEOUT = 30.0


class Client:
    """RankLoop API 客户端。

    典型用法——提交、按建议修复、发布：

        from rankloop import Client, PublishBlockedError

        client = Client(api_key="rkl_live_xxx")
        content = client.submit(site_id, path="/posts/hello", body=html)

        try:
            client.publish(content.id)
        except PublishBlockedError as e:
            print("发不出去，必须先修：", e.blocking)
    """

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        retries: int = DEFAULT_RETRIES,
    ) -> None:
        if not api_key:
            raise ValueError("api_key 不能为空，请向平台管理员索取")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.retries = retries

    # ---------- 内容 ----------

    def check(self, *, body: str, url: str, format: Format = "html") -> CheckResult:
        """无状态预检：不落库，只看内容有没有问题。

        适合在 CI 里当门禁用——内容还没提交就能知道能不能发。
        """
        data = self._request(
            "POST", "/contents/check", {"format": format, "body": body, "url": url}
        )
        return CheckResult.from_dict(data)

    def submit(
        self, site_id: str, *, path: str, body: str, format: Format = "html"
    ) -> Content:
        """提交新内容。同一站点下 path 唯一。"""
        data = self._request(
            "POST",
            f"/sites/{site_id}/contents",
            {"path": path, "format": format, "body": body},
        )
        return Content.from_dict(data)

    def update(self, content_id: str, *, body: str, format: Format | None = None) -> Content:
        """更新内容，产生新版本。已发布的内容更新后不会自动重新发布。"""
        payload: dict[str, Any] = {"body": body}
        if format:
            payload["format"] = format
        data = self._request("PUT", f"/contents/{content_id}", payload)
        return Content.from_dict(data)

    def get(self, content_id: str) -> dict[str, Any]:
        """查看内容详情与最新检测结果。"""
        return self._request("GET", f"/contents/{content_id}")

    def list_contents(self, site_id: str, *, status: str | None = None,
                      limit: int = 50) -> list[Content]:
        """列出站点内容。"""
        q = f"?limit={limit}" + (f"&status={status}" if status else "")
        data = self._request("GET", f"/sites/{site_id}/contents{q}")
        return [Content.from_dict(c) for c in data]

    def publish(self, content_id: str) -> Content:
        """发布内容。

        存在严重问题时抛出 :class:`PublishBlockedError`——
        这是设计如此，不是异常情况。门槛在服务端聚合根里，
        任何调用方都绕不过去。
        """
        data = self._request("POST", f"/contents/{content_id}/publish")
        return Content.from_dict(data)

    def recommendations(self, content_id: str) -> tuple[list[Recommendation], Impact]:
        """获取按性价比排序的优化建议。

        返回 ``(建议列表, 收益汇总)``。列表已按「每分钟能挽回多少分」
        排好序，阻断发布的排最前，直接从头做即可。
        """
        data = self._request("GET", f"/contents/{content_id}/recommendations")
        items = [Recommendation.from_dict(i) for i in data.get("items", [])]
        return items, Impact.from_dict(data.get("impact", {}))

    def publish_when_ready(self, content_id: str) -> tuple[bool, list[Recommendation]]:
        """尝试发布；被拦截时返回待修复项而不抛异常。

        适合批量流程——不想为每条内容写 try/except 时用这个：

            ok, todo = client.publish_when_ready(cid)
            if not ok:
                for r in todo:
                    print(r.message, f"约 {r.minutes} 分钟")
        """
        try:
            self.publish(content_id)
            return True, []
        except PublishBlockedError:
            items, _ = self.recommendations(content_id)
            return False, [r for r in items if r.blocking]

    # ---------- 规则 ----------

    def rules(self) -> list[dict[str, Any]]:
        """列出全部检测规则及其权重。"""
        return self._request("GET", "/rules")

    # ---------- 内部 ----------

    def _request(self, method: str, path: str, body: Any = None) -> Any:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode() if body is not None else None
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
            "User-Agent": "rankloop-python/0.1.0",
        }
        if data:
            headers["Content-Type"] = "application/json"

        last_err: Exception | None = None
        for attempt in range(self.retries + 1):
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    payload = json.loads(resp.read().decode() or "{}")
                    return payload.get("data", payload)
            except urllib.error.HTTPError as e:
                raw = e.read().decode()
                # 4xx 是调用方的问题，重试没有意义，立即抛出
                if e.code < 500:
                    raise self._to_error(e.code, raw) from None
                last_err = RankLoopError(f"服务端错误 {e.code}: {raw[:200]}")
            except urllib.error.URLError as e:
                last_err = RankLoopError(f"网络错误：{e.reason}")

            if attempt < self.retries:
                # 指数退避，避免服务端抖动时被同一批请求压垮
                time.sleep(2**attempt * 0.5)

        raise last_err or RankLoopError("请求失败")

    @staticmethod
    def _to_error(status: int, raw: str) -> RankLoopError:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return RankLoopError(f"HTTP {status}: {raw[:200]}")

        err = payload.get("error", {})
        code = err.get("code", "")
        msg = err.get("message", f"HTTP {status}")
        details = err.get("details", {})
        rid = payload.get("meta", {}).get("request_id", "")

        if code == "SEO_GATE_FAILED":
            return PublishBlockedError(
                msg,
                blocking=details.get("blocking", []),
                score=details.get("score", 0),
                code=code,
                request_id=rid,
            )
        if status == 401:
            return AuthError(msg, code=code, request_id=rid)
        if status == 404:
            return NotFoundError(msg, code=code, request_id=rid)
        if status == 429:
            return QuotaExceededError(msg, code=code, request_id=rid)
        if status in (400, 422):
            return ValidationError(msg, code=code, request_id=rid, details=details)
        return RankLoopError(msg, code=code, request_id=rid)
