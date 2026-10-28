from decimal import Decimal, InvalidOperation

from app.modules.formulas.ast_nodes import (
    BinaryOp,
    FunctionCall,
    Literal,
    Node,
    Reference,
    UnaryMinus,
)
from app.modules.formulas.errors import FormulaSyntaxError, UnknownFunctionError
from app.modules.formulas.tokens import Token, TokenType, tokenize

ALLOWED_FUNCTIONS = frozenset({"SUM", "MIN", "MAX", "ABS", "ROUND", "COALESCE"})


class _Parser:
    def __init__(self, tokens: list[Token]):
        self._tokens = tokens
        self._pos = 0

    @property
    def current(self) -> Token:
        return self._tokens[self._pos]

    def advance(self) -> Token:
        token = self._tokens[self._pos]
        self._pos += 1
        return token

    def expect(self, token_type: TokenType) -> Token:
        if self.current.type is not token_type:
            raise FormulaSyntaxError(
                f"Expected {token_type.name} at position {self.current.position}, "
                f"found {self.current.type.name}"
            )
        return self.advance()

    def parse_expression(self) -> Node:
        node = self.parse_term()
        while self.current.type in (TokenType.PLUS, TokenType.MINUS):
            op = "+" if self.advance().type is TokenType.PLUS else "-"
            node = BinaryOp(op, node, self.parse_term())
        return node

    def parse_term(self) -> Node:
        node = self.parse_unary()
        while self.current.type in (TokenType.STAR, TokenType.SLASH):
            op = "*" if self.advance().type is TokenType.STAR else "/"
            node = BinaryOp(op, node, self.parse_unary())
        return node

    def parse_unary(self) -> Node:
        if self.current.type is TokenType.MINUS:
            self.advance()
            return UnaryMinus(self.parse_unary())
        return self.parse_primary()

    def parse_primary(self) -> Node:
        token = self.current
        if token.type is TokenType.NUMBER:
            self.advance()
            try:
                return Literal(Decimal(token.value))
            except InvalidOperation as exc:
                raise FormulaSyntaxError(
                    f"Invalid number {token.value!r} at position {token.position}"
                ) from exc
        if token.type is TokenType.REFERENCE:
            self.advance()
            return Reference(list(token.value))
        if token.type is TokenType.LPAREN:
            self.advance()
            node = self.parse_expression()
            self.expect(TokenType.RPAREN)
            return node
        if token.type is TokenType.IDENT:
            self.advance()
            name = token.value.upper()
            if name not in ALLOWED_FUNCTIONS:
                raise UnknownFunctionError(
                    f"Unknown function {token.value!r} at position {token.position}"
                )
            self.expect(TokenType.LPAREN)
            args: list[Node] = []
            if self.current.type is not TokenType.RPAREN:
                args.append(self.parse_expression())
                while self.current.type is TokenType.COMMA:
                    self.advance()
                    args.append(self.parse_expression())
            self.expect(TokenType.RPAREN)
            return FunctionCall(name, args)
        raise FormulaSyntaxError(
            f"Unexpected {token.type.name} at position {token.position}"
        )


def parse(text: str) -> Node:
    parser = _Parser(tokenize(text))
    node = parser.parse_expression()
    if parser.current.type is not TokenType.EOF:
        raise FormulaSyntaxError(
            f"Unexpected trailing input at position {parser.current.position}"
        )
    return node
