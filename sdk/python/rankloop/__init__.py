"""RankLoop —— SEO 全生命周期平台的 Python 客户端。

    from rankloop import Client, PublishBlockedError

    client = Client(api_key="rkl_live_xxx")
    content = client.submit(site_id, path="/posts/hello", body=html)

    try:
        client.publish(content.id)
    except PublishBlockedError as e:
        print("必须先修：", e.blocking)
"""

from .client import Client
from .errors import (
    AuthError,
    NotFoundError,
    PublishBlockedError,
    QuotaExceededError,
    RankLoopError,
    ValidationError,
)
from .models import CheckResult, Content, Impact, Issue, Recommendation

__version__ = "0.1.0"

__all__ = [
    "Client",
    "RankLoopError",
    "AuthError",
    "NotFoundError",
    "ValidationError",
    "QuotaExceededError",
    "PublishBlockedError",
    "Issue",
    "Recommendation",
    "CheckResult",
    "Impact",
    "Content",
]
