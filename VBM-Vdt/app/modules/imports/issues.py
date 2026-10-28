from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Severity(str, Enum):
    BLOCKING = "BLOCKING"
    WARNING = "WARNING"


@dataclass
class ImportIssue:
    code: str
    severity: Severity
    message: str
    sheet: Optional[str] = None
    row: Optional[int] = None
    column: Optional[str] = None
    node_code: Optional[str] = None


@dataclass
class IssueCollector:
    items: list[ImportIssue] = field(default_factory=list)

    def blocking(self, code: str, message: str, **location) -> None:
        self.items.append(ImportIssue(code, Severity.BLOCKING, message, **location))

    def warning(self, code: str, message: str, **location) -> None:
        self.items.append(ImportIssue(code, Severity.WARNING, message, **location))

    @property
    def has_blocking(self) -> bool:
        return any(i.severity is Severity.BLOCKING for i in self.items)

    def count(self, severity: Severity) -> int:
        return sum(1 for i in self.items if i.severity is severity)
