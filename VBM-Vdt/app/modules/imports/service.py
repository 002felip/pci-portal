from dataclasses import dataclass

from app.modules.imports.issues import ImportIssue, IssueCollector
from app.modules.imports.models import ParsedWorkbook
from app.modules.imports.validators import validate_formulas, validate_structure
from app.modules.imports.workbook_reader import read_workbook


@dataclass
class ImportResult:
    parsed: ParsedWorkbook
    issues: list[ImportIssue]
    is_publishable: bool


def parse_and_validate(path) -> ImportResult:
    collector = IssueCollector()
    parsed = read_workbook(path, collector)
    validate_structure(parsed, collector)
    if not collector.has_blocking:
        # Formula rules need a trustworthy registry and node index; running them
        # over a structurally broken workbook only produces noise.
        validate_formulas(parsed, collector)
    return ImportResult(parsed, collector.items, not collector.has_blocking)
