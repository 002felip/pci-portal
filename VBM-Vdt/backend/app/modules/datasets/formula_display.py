from typing import TYPE_CHECKING

from app.modules.formulas.ast_nodes import BinaryOp, FunctionCall, Literal, Node, Reference, UnaryMinus
from app.modules.formulas.dependencies import _to_node_ref
from app.modules.formulas.parser import parse as parse_formula

if TYPE_CHECKING:
    from app.modules.datasets.graph_builder import NodeInfo

# Standard arithmetic precedence - the parsed tree no longer carries the
# source's own parentheses, so re-rendering has to reinsert exactly the ones
# the tree's real grouping requires (dropping them all would silently change
# what the formula appears to mean, e.g. "(A - B) * C" rendering as
# "A - B * C").
_PRECEDENCE = {"+": 1, "-": 1, "*": 2, "/": 2}


def render_formula_display(
    formula_text: str, owner_tree_code: str, node_index: "dict[str, NodeInfo]",
) -> str:
    """Re-renders a parsed formula with every reference's node_code/tree_code
    substituted for its real kpi_name/tree_name, keeping the workbook's own
    [X] / [X].[Y] bracket shape - a same-tree reference stays a single
    [KPI Name] bracket, a cross-tree one becomes [Tree Name].[KPI Name]."""

    def render_reference(ref_node: Reference) -> str:
        ref = _to_node_ref(ref_node.parts)
        tree_code = ref.tree_code or owner_tree_code
        target = node_index.get(f"{tree_code}.{ref.node_code}")
        if target is None:
            # An unresolved reference is already a structural import issue
            # reported elsewhere - fall back to the raw parts rather than
            # let a display-only endpoint crash over it.
            return "[" + "].[".join(ref_node.parts) + "]"
        if tree_code == owner_tree_code:
            return f"[{target.kpi_name}]"
        return f"[{target.tree_name}].[{target.kpi_name}]"

    def render(current: Node, ctx_precedence: int) -> str:
        if isinstance(current, Literal):
            return str(current.value)
        if isinstance(current, Reference):
            return render_reference(current)
        if isinstance(current, UnaryMinus):
            return f"-{render(current.operand, 3)}"
        if isinstance(current, BinaryOp):
            precedence = _PRECEDENCE[current.op]
            left = render(current.left, precedence)
            # The right side needs strictly higher precedence to safely drop
            # its own parens: "-" and "/" are not associative, so
            # "A - (B - C)" must never render as "A - B - C".
            right = render(current.right, precedence + 1)
            text = f"{left} {current.op} {right}"
            return f"({text})" if precedence < ctx_precedence else text
        if isinstance(current, FunctionCall):
            args = ", ".join(render(arg, 0) for arg in current.args)
            return f"{current.name}({args})"
        raise TypeError(f"Unknown AST node: {current!r}")

    return render(parse_formula(formula_text), 0)
