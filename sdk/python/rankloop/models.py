"""返回值类型。

用 dataclass 而非裸 dict：调用方有补全和类型检查，
字段改名时也能在静态检查阶段发现，而不是线上 KeyError。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Issue:
    """一条检测出的 SEO 问题。"""

    code: str
    severity: str
    message: str
    evidence: str = ""
    recommendation: str = ""

    @property
    def blocking(self) -> bool:
        """是否阻断发布。只有 critical 会挡住发布。"""
        return self.severity == "critical"

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Issue:
        return cls(
            code=d.get("code", ""),
            severity=d.get("severity", ""),
            message=d.get("message", ""),
            evidence=d.get("evidence", "") or "",
            recommendation=d.get("recommendation", "") or "",
        )


@dataclass(frozen=True)
class Recommendation(Issue):
    """带修复成本的优化建议。

    比 Issue 多出的三个字段是本平台的差异化能力：
    知道「修好能加几分」和「大概要花多久」，才排得出优先级。
    """

    gain: int = 0
    minutes: int = 0
    effort: str = ""

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Recommendation:
        return cls(
            code=d.get("code", ""),
            severity=d.get("severity", ""),
            message=d.get("message", ""),
            evidence=d.get("evidence", "") or "",
            recommendation=d.get("recommendation", "") or "",
            gain=d.get("gain", 0),
            minutes=d.get("minutes", 0),
            effort=d.get("effort", ""),
        )


@dataclass(frozen=True)
class CheckResult:
    """一次检测的结果。"""

    score: int
    issues: list[Issue] = field(default_factory=list)
    critical: int = 0
    warning: int = 0
    notice: int = 0
    #: 是否可以发布。注意分数高不等于可发布——
    #: 只要有一条 critical 就发不出去，哪怕 90 分。
    publishable: bool = False

    @property
    def blocking_issues(self) -> list[Issue]:
        """阻断发布的问题。修完这些才能发。"""
        return [i for i in self.issues if i.blocking]

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> CheckResult:
        check = d.get("check", d)
        counts = check.get("counts", {})
        issues = [Issue.from_dict(i) for i in check.get("issues", [])]
        return cls(
            score=check.get("score", 0),
            issues=issues,
            critical=counts.get("critical", 0),
            warning=counts.get("warning", 0),
            notice=counts.get("notice", 0),
            # 顶层没给 publishable 时按有无 critical 推断
            publishable=d.get("publishable", not any(i.blocking for i in issues)),
        )


@dataclass(frozen=True)
class Impact:
    """修复收益汇总，用于回答「花多少时间能提多少分」。"""

    current: int = 0
    potential: int = 0
    quick_win: int = 0
    quick_minutes: int = 0
    blocking_count: int = 0
    total_minutes: int = 0

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Impact:
        return cls(
            current=d.get("current", 0),
            potential=d.get("potential", 0),
            quick_win=d.get("quick_win", d.get("quickWin", 0)),
            quick_minutes=d.get("quick_minutes", d.get("quickMinutes", 0)),
            blocking_count=d.get("blocking_count", d.get("blockingCount", 0)),
            total_minutes=d.get("total_minutes", d.get("totalMinutes", 0)),
        )


@dataclass(frozen=True)
class Content:
    """一条内容。"""

    id: str
    path: str
    status: str
    score: int | None = None
    published_at: str | None = None

    @property
    def is_published(self) -> bool:
        return self.status == "published"

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Content:
        return cls(
            id=d.get("id", ""),
            path=d.get("path", ""),
            status=d.get("status", ""),
            score=d.get("score"),
            published_at=d.get("published_at"),
        )
