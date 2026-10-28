from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional


@dataclass
class YearBlock:
    year: int
    columns: dict[str, int]  # "Actuals" -> column index (1-based)


@dataclass
class ParsedValue:
    year: int
    context: str          # "Actuals" | "Budget" | "LoBP" | "Benchmark"
    value: Optional[Decimal]
    row: int
    column: int


@dataclass
class ParsedNode:
    node_code: Optional[str]
    parent_node_code: Optional[str]
    display_order: Optional[int]
    kpi_name: Optional[str]
    description: Optional[str]
    unit: Optional[str]
    node_type: Optional[str]
    formula: Optional[str]
    favorable_direction: Optional[str]
    values: list[ParsedValue] = field(default_factory=list)
    row: int = 0


@dataclass
class ParsedTree:
    tree_code: Optional[str]
    tree_name: Optional[str]
    tree_type: Optional[str]
    pair_code: Optional[str]
    worksheet: Optional[str]
    registry_row: int = 0
    year_blocks: list[YearBlock] = field(default_factory=list)
    nodes: list[ParsedNode] = field(default_factory=list)


@dataclass
class ParsedWorkbook:
    template_version: Optional[str] = None
    workbook_type: Optional[str] = None
    region_code: Optional[str] = None
    region_name: Optional[str] = None
    revision_cycle_year: Optional[int] = None
    trees: list[ParsedTree] = field(default_factory=list)
