from dataclasses import dataclass
from enum import Enum, auto
from typing import Union

from app.modules.formulas.errors import FormulaSyntaxError


class TokenType(Enum):
    NUMBER = auto()
    REFERENCE = auto()
    IDENT = auto()
    LPAREN = auto()
    RPAREN = auto()
    COMMA = auto()
    PLUS = auto()
    MINUS = auto()
    STAR = auto()
    SLASH = auto()
    EOF = auto()


@dataclass
class Token:
    type: TokenType
    value: Union[str, list[str], None]
    position: int


_SINGLE = {
    "(": TokenType.LPAREN,
    ")": TokenType.RPAREN,
    ",": TokenType.COMMA,
    "+": TokenType.PLUS,
    "-": TokenType.MINUS,
    "*": TokenType.STAR,
    "/": TokenType.SLASH,
}


def tokenize(text: str) -> list[Token]:
    tokens: list[Token] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch.isspace():
            i += 1
            continue
        if ch in _SINGLE:
            tokens.append(Token(_SINGLE[ch], ch, i))
            i += 1
            continue
        if ch.isdigit() or (ch == "." and i + 1 < n and text[i + 1].isdigit()):
            start = i
            seen_dot = False
            while i < n and (text[i].isdigit() or (text[i] == "." and not seen_dot)):
                if text[i] == ".":
                    seen_dot = True
                i += 1
            tokens.append(Token(TokenType.NUMBER, text[start:i], start))
            continue
        if ch == "[":
            start = i
            parts: list[str] = []
            while i < n and text[i] == "[":
                close = text.find("]", i)
                if close == -1:
                    raise FormulaSyntaxError(
                        f"Unterminated reference starting at position {start}"
                    )
                parts.append(text[i + 1 : close])
                i = close + 1
                if i < n and text[i] == ".":
                    i += 1
                    if i >= n or text[i] != "[":
                        raise FormulaSyntaxError(
                            f"Expected '[' after '.' at position {i}"
                        )
                else:
                    break
            tokens.append(Token(TokenType.REFERENCE, parts, start))
            continue
        if ch.isalpha() or ch == "_":
            start = i
            while i < n and (text[i].isalnum() or text[i] == "_"):
                i += 1
            tokens.append(Token(TokenType.IDENT, text[start:i], start))
            continue
        raise FormulaSyntaxError(f"Unexpected character {ch!r} at position {i}")
    tokens.append(Token(TokenType.EOF, None, n))
    return tokens
