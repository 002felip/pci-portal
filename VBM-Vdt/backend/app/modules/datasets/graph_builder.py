from dataclasses import dataclass, field
from typing import Optional

from app.domain.enums import FavorableDirection, NodeType
from app.modules.datasets.structure_repositories import (
    SqliteNodeDependencyRepository,
    SqliteNodeFormulaRepository,
    SqliteTreeStructureRepository,
)
from app.modules.datasets.tree_repositories import SqliteTreeNodeRepository, SqliteTreeRepository


@dataclass
class NodeInfo:
    node_id: str
    tree_id: str
    tree_code: str
    tree_name: str
    node_code: str
    node_type: NodeType
    favorable_direction: Optional[FavorableDirection]
    kpi_name: str
    unit: Optional[str]
    formula: Optional[str]


@dataclass
class DatasetGraph:
    node_index: dict[str, NodeInfo] = field(default_factory=dict)
    node_id_to_key: dict[str, str] = field(default_factory=dict)
    forward: dict[str, set[str]] = field(default_factory=dict)
    reverse: dict[str, set[str]] = field(default_factory=dict)


def build_dataset_graph(conn, dataset_cycle_id: str) -> DatasetGraph:
    trees_repo = SqliteTreeRepository(conn)
    structures = SqliteTreeStructureRepository(conn)
    nodes_repo = SqliteTreeNodeRepository(conn)
    formulas = SqliteNodeFormulaRepository(conn)
    dependencies = SqliteNodeDependencyRepository(conn)

    graph = DatasetGraph()

    # Pass 1: every node gets a key and an index entry, so pass 2 can resolve
    # cross-tree dependency targets regardless of which tree defines them.
    trees = trees_repo.list_by_dataset_cycle(dataset_cycle_id)
    tree_nodes = {}
    for tree in trees:
        structure_id = structures.get_for_tree(tree.tree_id)
        nodes = nodes_repo.list_all(structure_id) if structure_id else []
        tree_nodes[tree.tree_code] = nodes
        for node in nodes:
            key = f"{tree.tree_code}.{node.node_code}"
            formula = None
            if node.node_type is NodeType.CALCULATED:
                stored = formulas.get_for_node(node.node_id)
                formula = stored.expression if stored else None
            graph.node_index[key] = NodeInfo(
                node_id=node.node_id, tree_id=tree.tree_id, tree_code=tree.tree_code,
                tree_name=tree.tree_name_original, node_code=node.node_code,
                node_type=node.node_type, favorable_direction=node.favorable_direction,
                kpi_name=node.kpi_name_original, unit=node.unit_original, formula=formula,
            )
            graph.node_id_to_key[node.node_id] = key
            graph.forward[key] = set()
            graph.reverse.setdefault(key, set())

    # Pass 2: forward/reverse edges, once every node_id is resolvable to a key.
    for tree in trees:
        for node in tree_nodes[tree.tree_code]:
            if node.node_type is not NodeType.CALCULATED:
                continue
            key = f"{tree.tree_code}.{node.node_code}"
            for dep in dependencies.list_for_result_node(node.node_id):
                if dep.source_node_id is None:
                    continue  # unresolved dependency; nothing to recalculate from
                dep_key = graph.node_id_to_key.get(dep.source_node_id)
                if dep_key is None:
                    continue
                graph.forward[key].add(dep_key)
                graph.reverse.setdefault(dep_key, set()).add(key)

    return graph
