from dataclasses import dataclass
from decimal import Decimal

from app.domain.enums import NodeType
from app.modules.datasets.graph_builder import DatasetGraph


class InvalidOverrideError(Exception):
    pass


@dataclass(frozen=True)
class OverrideInput:
    tree_code: str
    node_code: str
    value: Decimal


def validate_overrides(graph: DatasetGraph, overrides: list[OverrideInput]) -> dict[str, Decimal]:
    resolved: dict[str, Decimal] = {}
    for override in overrides:
        key = f"{override.tree_code}.{override.node_code}"
        info = graph.node_index.get(key)
        if info is None:
            raise InvalidOverrideError(
                f"UNKNOWN_OVERRIDE_NODE: {override.tree_code}.{override.node_code} does not exist"
            )
        if info.node_type is NodeType.GROUP:
            raise InvalidOverrideError(
                f"GROUP_OVERRIDE_NOT_ALLOWED: {key} is a GROUP node and has no value to override"
            )
        if key in resolved:
            raise InvalidOverrideError(f"DUPLICATE_OVERRIDE: {key} was overridden more than once")
        resolved[key] = override.value
    return resolved
