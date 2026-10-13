from __future__ import annotations

import ast
import re
from typing import Any


_IDENTIFIER = r"[A-Za-z_][A-Za-z0-9_]*"
_BRACKET_KEY = r"\[(?:\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*')\]"
_PATH_PART = rf"(?:{_IDENTIFIER}|[0-9]+|{_BRACKET_KEY})"
_PATH = rf"{_IDENTIFIER}(?:\.{_PATH_PART}|{_BRACKET_KEY})*"
EXPRESSION_RE = re.compile(rf"^\s*\{{\{{\s*({_PATH})\s*\}}\}}\s*$")
INLINE_EXPRESSION_RE = re.compile(rf"\{{\{{\s*({_PATH})\s*\}}\}}")
EXPRESSION_TOKEN_RE = re.compile(r"\{\{.*?\}\}")
_PATH_TOKEN_RE = re.compile(rf"{_IDENTIFIER}|[0-9]+|{_BRACKET_KEY}")


class ExpressionError(ValueError):
    pass


def resolve_expression(value: Any, context: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        return {key: resolve_expression(item, context) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve_expression(item, context) for item in value]
    if not isinstance(value, str):
        return value
    match = EXPRESSION_RE.match(value)
    if match is not None:
        return resolve_path(match.group(1), context)
    if INLINE_EXPRESSION_RE.search(value) is None:
        return value
    return INLINE_EXPRESSION_RE.sub(lambda match: str(resolve_path(match.group(1), context)), value)


def resolve_path(path: str, context: dict[str, Any]) -> Any:
    current: Any = context
    for token in _PATH_TOKEN_RE.findall(path):
        part = _decode_path_token(token)
        if isinstance(current, dict) and part in current:
            current = current[part]
        elif isinstance(current, list) and part.isdigit():
            index = int(part)
            if index >= len(current):
                raise ExpressionError(f"Cannot resolve expression path: {path}")
            current = current[index]
        else:
            raise ExpressionError(f"Cannot resolve expression path: {path}")
    return current


def _decode_path_token(token: str) -> str:
    if not token.startswith("["):
        return token
    # The expression grammar only permits quoted keys inside brackets.
    return ast.literal_eval(token[1:-1])


def invalid_expression_tokens(value: str) -> list[str]:
    if "{{" not in value and "}}" not in value:
        return []
    tokens = EXPRESSION_TOKEN_RE.findall(value)
    if not tokens:
        return [value]
    invalid = [token for token in tokens if EXPRESSION_RE.match(token) is None]
    remainder = EXPRESSION_TOKEN_RE.sub("", value)
    if "{{" in remainder or "}}" in remainder:
        invalid.append(value)
    return invalid
