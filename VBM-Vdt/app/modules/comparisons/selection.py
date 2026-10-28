from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from app.domain.enums import NodeType, ValueContext, ValueOrigin, ValueStatus
from app.modules.datasets.period_repository import SqliteReportingPeriodRepository
from app.modules.datasets.repositories import (
    SqliteDatasetCycleRepository,
    SqliteRevisionCycleRepository,
)
from app.modules.datasets.structure_repositories import SqliteTreeStructureRepository
from app.modules.datasets.tree_repositories import SqliteTreeRepository
from app.modules.datasets.value_repositories import SqliteNodeValueRepository


class SelectionNotFoundError(Exception):
    pass


@dataclass(frozen=True)
class SelectionKey:
    context: ValueContext
    reference_year: int
    revision_cycle_year: int


@dataclass
class ResolvedNodeValue:
    status: ValueStatus
    value: Optional[Decimal]
    value_origin: Optional[ValueOrigin] = None


def is_value_overridden(node_type: NodeType, origin: Optional[ValueOrigin]) -> bool:
    """A CALCULATED node's own supplied value overriding its formula for one
    cell (see publication.py's _value_for) is the only case this means
    anything for - an INPUT node's value_origin is also ValueOrigin.INPUT
    (there is no formula for it to override), and a GROUP node never has a
    resolved value."""
    return node_type is NodeType.CALCULATED and origin is ValueOrigin.INPUT


@dataclass
class ResolvedSelection:
    tree_id: str
    tree_structure_id: str
    dataset_cycle_id: str
    period_id: int
    nodes: dict[str, ResolvedNodeValue]


def resolve_selection(conn, dataset_id: str, tree_code: str, key: SelectionKey) -> ResolvedSelection:
    cycle = SqliteRevisionCycleRepository(conn).get_by_year(key.revision_cycle_year)
    if cycle is None:
        raise SelectionNotFoundError(f"No revision cycle {key.revision_cycle_year}")

    dataset_cycle = SqliteDatasetCycleRepository(conn).get(dataset_id, cycle.revision_cycle_id)
    if dataset_cycle is None:
        raise SelectionNotFoundError(
            f"Dataset {dataset_id} has no publication for cycle {key.revision_cycle_year}"
        )

    tree = SqliteTreeRepository(conn).get_by_code(dataset_cycle.dataset_cycle_id, tree_code)
    if tree is None:
        raise SelectionNotFoundError(
            f"No tree {tree_code!r} in cycle {key.revision_cycle_year} of dataset {dataset_id}"
        )

    structure_id = SqliteTreeStructureRepository(conn).get_for_tree(tree.tree_id)
    if structure_id is None:
        raise SelectionNotFoundError(f"Tree {tree.tree_id} has no structure")

    period_id = SqliteReportingPeriodRepository(conn).get_by_year(key.reference_year)
    if period_id is None:
        raise SelectionNotFoundError(f"No reference year {key.reference_year} has ever been published")

    values = SqliteNodeValueRepository(conn).list_for_cycle_context(
        dataset_cycle.dataset_cycle_id, key.context, period_id
    )
    nodes = {node_id: ResolvedNodeValue(v.value_status, v.value, v.value_origin)
             for node_id, v in values.items()}
    return ResolvedSelection(tree.tree_id, structure_id, dataset_cycle.dataset_cycle_id, period_id, nodes)
