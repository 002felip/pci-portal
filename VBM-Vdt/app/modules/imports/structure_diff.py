from dataclasses import dataclass, field
from typing import Optional

from app.modules.imports.models import ParsedWorkbook

# The same nine structural columns canonical_structure_hash normalized over,
# minus node_code itself (the join key, never a "changed field") and tree
# identity (tree_code is part of the key, not a per-node field).
STRUCTURAL_FIELDS = (
    "parent_node_code", "display_order", "kpi_name", "description",
    "unit", "node_type", "formula", "favorable_direction",
)


@dataclass
class OldNode:
    """One previously-published node, loaded from the database by the
    caller (see PublicationService.load_old_nodes) - the shape structure_diff
    needs to compare against an incoming ParsedNode, field-for-field."""
    tree_code: str
    node_code: str
    parent_node_code: Optional[str]
    display_order: int
    kpi_name: str
    description: Optional[str]
    unit: Optional[str]
    node_type: str
    formula: Optional[str]
    favorable_direction: Optional[str]


@dataclass
class NodeRef:
    tree_code: str
    node_code: str
    kpi_name: str


@dataclass
class ChangedNode:
    tree_code: str
    node_code: str
    kpi_name: str
    fields: list[str]


@dataclass
class StructureChange:
    added: list[NodeRef] = field(default_factory=list)
    removed: list[NodeRef] = field(default_factory=list)
    changed: list[ChangedNode] = field(default_factory=list)

    def __bool__(self) -> bool:
        return bool(self.added or self.removed or self.changed)


def structure_diff(old_nodes: list[OldNode], parsed: ParsedWorkbook) -> StructureChange:
    old_by_key = {(n.tree_code, n.node_code): n for n in old_nodes}
    new_by_key = {}
    for tree in parsed.trees:
        for node in tree.nodes:
            new_by_key[(tree.tree_code, node.node_code)] = node

    change = StructureChange()

    for key, old in old_by_key.items():
        if key not in new_by_key:
            change.removed.append(NodeRef(key[0], key[1], old.kpi_name))

    for key, new in new_by_key.items():
        old = old_by_key.get(key)
        if old is None:
            change.added.append(NodeRef(key[0], key[1], new.kpi_name or ""))
            continue
        changed_fields = [
            f for f in STRUCTURAL_FIELDS if getattr(old, f) != getattr(new, f)
        ]
        if changed_fields:
            change.changed.append(
                ChangedNode(key[0], key[1], new.kpi_name or old.kpi_name, changed_fields))

    return change
