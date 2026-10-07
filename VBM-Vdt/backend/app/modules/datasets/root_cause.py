from collections import deque
from dataclasses import dataclass
from typing import Callable

from app.domain.enums import ValueStatus
from app.modules.datasets.graph_builder import DatasetGraph


@dataclass
class RootCause:
    tree_code: str
    tree_name: str
    node_code: str
    node_id: str
    kpi_name: str


def find_missing_root_causes(
    graph: DatasetGraph, start_key: str, status_of: Callable[[str], ValueStatus],
) -> list[RootCause]:
    """From start_key (already known to be MISSING_DEPENDENCY under whatever
    selection status_of resolves), walks forward dependencies to find the
    node(s) with no value at all. MISSING_DEPENDENCY only ever propagates
    from something else, so it is never itself reported; a dependency that
    resolved to anything other than MISSING/MISSING_DEPENDENCY explains
    nothing about start_key's own unavailability, so its own dependencies
    are not explored further."""
    visited = {start_key}
    queue: deque[str] = deque([start_key])
    causes: list[RootCause] = []
    seen_causes: set[str] = set()

    while queue:
        key = queue.popleft()
        for dep_key in sorted(graph.forward.get(key, ())):
            if dep_key in visited:
                continue
            visited.add(dep_key)
            status = status_of(dep_key)
            if status is ValueStatus.MISSING:
                if dep_key not in seen_causes:
                    seen_causes.add(dep_key)
                    info = graph.node_index[dep_key]
                    causes.append(RootCause(
                        tree_code=info.tree_code, tree_name=info.tree_name,
                        node_code=info.node_code, node_id=info.node_id, kpi_name=info.kpi_name,
                    ))
            elif status is ValueStatus.MISSING_DEPENDENCY:
                queue.append(dep_key)

    return causes
