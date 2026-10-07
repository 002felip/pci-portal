from dataclasses import dataclass
from typing import Optional

from app.modules.formulas.ast_nodes import (
    BinaryOp,
    FunctionCall,
    Literal,
    Node,
    Reference,
    UnaryMinus,
)
from app.modules.formulas.errors import DependencyCycleError, InvalidReferenceError

SAME_TREE = "SAME_TREE"
SAME_REGION = "SAME_REGION"
REGIONAL_FCF = "REGIONAL_FCF"


@dataclass(frozen=True)
class NodeRef:
    region_code: Optional[str]
    tree_code: Optional[str]
    node_code: str
    scope: str


def _to_node_ref(parts: list[str]) -> NodeRef:
    if any(not p.strip() for p in parts):
        raise InvalidReferenceError(f"Reference contains an empty part: {parts!r}")
    if len(parts) == 1:
        return NodeRef(None, None, parts[0], SAME_TREE)
    if len(parts) == 2:
        return NodeRef(None, parts[0], parts[1], SAME_REGION)
    if len(parts) == 3:
        return NodeRef(parts[0], parts[1], parts[2], REGIONAL_FCF)
    raise InvalidReferenceError(
        f"Reference has {len(parts)} parts; only 1, 2 or 3 are valid: {parts!r}"
    )


def extract_references(node: Node) -> list[NodeRef]:
    found: list[NodeRef] = []
    seen: set[NodeRef] = set()

    def walk(current: Node) -> None:
        if isinstance(current, Literal):
            return
        if isinstance(current, Reference):
            ref = _to_node_ref(current.parts)
            if ref not in seen:
                seen.add(ref)
                found.append(ref)
            return
        if isinstance(current, UnaryMinus):
            walk(current.operand)
            return
        if isinstance(current, BinaryOp):
            walk(current.left)
            walk(current.right)
            return
        if isinstance(current, FunctionCall):
            for arg in current.args:
                walk(arg)
            return
        raise TypeError(f"Unknown AST node: {current!r}")

    walk(node)
    return found


def detect_cycle(graph: dict[str, set[str]]) -> Optional[list[str]]:
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {key: WHITE for key in graph}
    path: list[str] = []

    def visit(key: str) -> Optional[list[str]]:
        color[key] = GRAY
        path.append(key)
        for dep in sorted(graph.get(key, ())):
            if dep not in graph:
                continue  # unresolved external reference: not part of this graph
            if color[dep] == GRAY:
                return path[path.index(dep):] + [dep]
            if color[dep] == WHITE:
                found = visit(dep)
                if found:
                    return found
        path.pop()
        color[key] = BLACK
        return None

    for key in sorted(graph):
        if color[key] == WHITE:
            found = visit(key)
            if found:
                return found
    return None


def topological_order(graph: dict[str, set[str]]) -> list[str]:
    cycle = detect_cycle(graph)
    if cycle is not None:
        raise DependencyCycleError(cycle)

    ordered: list[str] = []
    visited: set[str] = set()

    def visit(key: str) -> None:
        if key in visited:
            return
        visited.add(key)
        for dep in sorted(graph.get(key, ())):
            if dep in graph:
                visit(dep)
        ordered.append(key)

    for key in sorted(graph):
        visit(key)
    return ordered
