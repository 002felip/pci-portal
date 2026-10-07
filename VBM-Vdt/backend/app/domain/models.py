from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from app.domain.enums import (
    DatasetType,
    FavorableDirection,
    NodeType,
    TreeType,
    ValueContext,
    ValueOrigin,
    ValueStatus,
)


@dataclass
class Region:
    region_id: str
    region_code: str
    region_name: str
    is_active: bool


@dataclass
class RevisionCycle:
    revision_cycle_id: int
    cycle_year: int
    cycle_code: str
    is_active: bool


@dataclass
class Dataset:
    dataset_id: str
    dataset_type: DatasetType
    region_id: Optional[str]
    dataset_code: str


@dataclass
class DatasetCycle:
    dataset_cycle_id: str
    dataset_id: str
    revision_cycle_id: int
    template_version: str
    publication_id: str
    published_at: str


@dataclass
class Tree:
    tree_id: str
    dataset_cycle_id: str
    tree_code: str
    tree_name_original: str
    tree_type: TreeType
    source_worksheet: str


@dataclass
class TreeNode:
    node_id: str
    tree_structure_id: str
    node_code: str
    parent_node_id: Optional[str]
    display_order: int
    kpi_name_original: str
    description_original: Optional[str]
    unit_original: Optional[str]
    node_type: NodeType
    favorable_direction: Optional[FavorableDirection]


@dataclass
class NodeFormula:
    formula_id: str
    node_id: str
    expression: str
    formula_language_version: str
    expression_hash: str
    is_active: bool


@dataclass
class NodeDependency:
    dependency_id: str
    formula_id: str
    result_node_id: str
    source_node_id: Optional[str]
    reference_scope: str
    source_region_code: Optional[str]
    source_tree_code: Optional[str]
    source_node_code: str
    resolution_status: str


@dataclass
class NodeValue:
    node_value_id: str
    dataset_cycle_id: str
    node_id: str
    value_context: ValueContext
    period_id: int
    value: Optional[Decimal]
    value_status: ValueStatus
    value_origin: ValueOrigin
    formula_id: Optional[str]
