from dataclasses import dataclass

from app.modules.datasets.graph_builder import build_dataset_graph


@dataclass
class NodeDependency:
    tree_code: str
    tree_name: str
    node_code: str
    node_id: str
    depends_on: list[str]


def list_dataset_dependencies(conn, dataset_cycle_id: str) -> list[NodeDependency]:
    """Pure formula-dependency structure for every node in one cycle - no
    baseline/comparator/override resolution, so the result never changes
    with selection and can be cached for that cycle's lifetime by callers
    (a cycle's structure is immutable once published - see the per-cycle
    tree restructuring design spec).
    Reuses build_dataset_graph unchanged; this is the same depends_on rule
    SimulationRow already applies, just without a value pass around it."""
    graph = build_dataset_graph(conn, dataset_cycle_id)
    return [
        NodeDependency(
            tree_code=info.tree_code, tree_name=info.tree_name,
            node_code=info.node_code, node_id=info.node_id,
            depends_on=sorted(graph.forward.get(key, set())),
        )
        for key, info in graph.node_index.items()
    ]
