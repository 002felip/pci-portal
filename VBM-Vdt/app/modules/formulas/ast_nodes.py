from dataclasses import dataclass, field
from decimal import Decimal
from typing import Union


@dataclass
class Literal:
    value: Decimal


@dataclass
class Reference:
    parts: list[str]


@dataclass
class UnaryMinus:
    operand: "Node"


@dataclass
class BinaryOp:
    op: str
    left: "Node"
    right: "Node"


@dataclass
class FunctionCall:
    name: str
    args: list["Node"] = field(default_factory=list)


Node = Union[Literal, Reference, UnaryMinus, BinaryOp, FunctionCall]
