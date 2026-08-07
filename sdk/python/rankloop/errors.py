"""RankLoop 异常类型。

设计原则：把「内容没通过 SEO 门槛」做成一个可以直接读出问题清单的异常，
而不是让调用方去解析 HTTP 422 的 JSON。这是本 SDK 最主要的价值——
门槛失败是正常业务流程的一部分（改完再发），不是意外错误。
"""

from __future__ import annotations

from typing import Any


class RankLoopError(Exception):
    """所有 RankLoop 异常的基类。"""

    def __init__(self, message: str, *, code: str = "", request_id: str = "") -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        # 出问题时把 request_id 提供给平台，能直接定位到那一次请求
        self.request_id = request_id


class AuthError(RankLoopError):
    """密钥无效或缺失（401）。"""


class NotFoundError(RankLoopError):
    """资源不存在，或不属于当前密钥所属租户（404）。

    跨租户访问同样返回本异常——平台不会告知资源是否真实存在。
    """


class ValidationError(RankLoopError):
    """请求参数不合法（400/422）。"""

    def __init__(self, message: str, *, code: str = "", request_id: str = "",
                 details: Any = None) -> None:
        super().__init__(message, code=code, request_id=request_id)
        self.details = details


class QuotaExceededError(RankLoopError):
    """超出套餐配额（429）。"""


class PublishBlockedError(RankLoopError):
    """内容存在严重问题，被发布门槛拦截。

    这不是「出错了」，而是「还不能发」。正确的处理方式是读取
    ``blocking`` 拿到阻断规则，修复后重新提交：

        try:
            client.publish(content_id)
        except PublishBlockedError as e:
            for code in e.blocking:
                print("必须修复:", code)
    """

    def __init__(self, message: str, *, blocking: list[str], score: int,
                 code: str = "", request_id: str = "") -> None:
        super().__init__(message, code=code, request_id=request_id)
        #: 阻断发布的规则编码，全部修复后才能发布
        self.blocking = blocking
        #: 当前健康分（0-100）
        self.score = score
