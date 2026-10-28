def find_ancestors(reverse_graph: dict[str, set[str]], starting: set[str]) -> set[str]:
    """Every key reachable from `starting` via reverse_graph, excluding the
    starting keys. reverse_graph[key] must hold the set of keys that directly
    depend on `key` (i.e. the inverse of the formula dependency graph)."""
    visited: set[str] = set()
    queue = list(starting)
    while queue:
        current = queue.pop()
        for dependent in reverse_graph.get(current, ()):
            if dependent not in visited and dependent not in starting:
                visited.add(dependent)
                queue.append(dependent)
    return visited
