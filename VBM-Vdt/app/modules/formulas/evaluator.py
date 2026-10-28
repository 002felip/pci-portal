from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, DivisionByZero, InvalidOperation
from typing import Callable, Optional

from app.domain.enums import ValueStatus
from app.modules.formulas.ast_nodes import (
    BinaryOp,
    FunctionCall,
    Literal,
    Node,
    Reference,
    UnaryMinus,
)
from app.modules.formulas.dependencies import NodeRef, _to_node_ref


@dataclass
class ResolvedValue:
    status: ValueStatus
    value: Optional[Decimal]


@dataclass
class EvaluationResult:
    status: ValueStatus
    value: Optional[Decimal]
    issue_code: Optional[str] = None


Resolver = Callable[[NodeRef], ResolvedValue]

# A dependency in one of these states makes the whole expression unavailable.
# NOT_INFORMED (Benchmark) propagates as NOT_INFORMED; the others as
# MISSING_DEPENDENCY - a calculated node is never itself "MISSING".
_PROPAGATION = {
    ValueStatus.MISSING: ValueStatus.MISSING_DEPENDENCY,
    ValueStatus.MISSING_DEPENDENCY: ValueStatus.MISSING_DEPENDENCY,
    ValueStatus.NOT_INFORMED: ValueStatus.NOT_INFORMED,
    ValueStatus.CALCULATION_ERROR: ValueStatus.CALCULATION_ERROR,
}


class _Unavailable(Exception):
    def __init__(self, status: ValueStatus, issue_code: Optional[str] = None):
        self.status = status
        self.issue_code = issue_code


def evaluate(node: Node, resolver: Resolver) -> EvaluationResult:
    try:
        value = _eval(node, resolver)
    except _Unavailable as unavailable:
        return EvaluationResult(unavailable.status, None, unavailable.issue_code)
    return EvaluationResult(ValueStatus.AVAILABLE, value)


def _eval(node: Node, resolver: Resolver) -> Decimal:
    if isinstance(node, Literal):
        return node.value

    if isinstance(node, Reference):
        resolved = resolver(_to_node_ref(node.parts))
        if resolved.status is ValueStatus.AVAILABLE:
            if resolved.value is None:
                raise _Unavailable(ValueStatus.CALCULATION_ERROR, "AVAILABLE_WITHOUT_VALUE")
            return resolved.value
        raise _Unavailable(_PROPAGATION[resolved.status])

    if isinstance(node, UnaryMinus):
        return -_eval(node.operand, resolver)

    if isinstance(node, BinaryOp):
        left = _eval(node.left, resolver)
        right = _eval(node.right, resolver)
        if node.op == "+":
            return left + right
        if node.op == "-":
            return left - right
        if node.op == "*":
            return left * right
        if node.op == "/":
            if right == 0:
                raise _Unavailable(ValueStatus.CALCULATION_ERROR, "DIVISION_BY_ZERO")
            try:
                return left / right
            except (DivisionByZero, InvalidOperation) as exc:
                raise _Unavailable(ValueStatus.CALCULATION_ERROR, "ARITHMETIC_ERROR") from exc
        raise _Unavailable(ValueStatus.CALCULATION_ERROR, "UNKNOWN_OPERATOR")

    if isinstance(node, FunctionCall):
        return _eval_function(node, resolver)

    raise _Unavailable(ValueStatus.CALCULATION_ERROR, "UNKNOWN_AST_NODE")


def _eval_function(node: FunctionCall, resolver: Resolver) -> Decimal:
    if node.name == "COALESCE":
        # Short-circuits: the point of COALESCE is to tolerate unavailable args.
        for arg in node.args:
            try:
                return _eval(arg, resolver)
            except _Unavailable:
                continue
        raise _Unavailable(ValueStatus.MISSING_DEPENDENCY, "COALESCE_ALL_UNAVAILABLE")

    args = [_eval(arg, resolver) for arg in node.args]
    if not args:
        raise _Unavailable(ValueStatus.CALCULATION_ERROR, "EMPTY_FUNCTION_ARGS")

    if node.name == "SUM":
        return sum(args, Decimal(0))
    if node.name == "MIN":
        return min(args)
    if node.name == "MAX":
        return max(args)
    if node.name == "ABS":
        return abs(args[0])
    if node.name == "ROUND":
        digits = int(args[1]) if len(args) > 1 else 0
        quantum = Decimal(1).scaleb(-digits)
        try:
            # ROUND_HALF_UP, not Decimal's default banker's rounding: the
            # business reads these numbers against Excel, where ROUND(2.345, 2)
            # is 2.35. Banker's rounding would return 2.34 and look like a bug.
            return args[0].quantize(quantum, rounding=ROUND_HALF_UP)
        except InvalidOperation as exc:
            raise _Unavailable(ValueStatus.CALCULATION_ERROR, "ROUND_ERROR") from exc
    raise _Unavailable(ValueStatus.CALCULATION_ERROR, "UNKNOWN_FUNCTION")
