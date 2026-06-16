from __future__ import annotations

import re
from typing import Any


EXPRESSION_RE = re.compile(
    r"^\s*\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+))*)\s*\}\}\s*$"
)


class ExpressionError(ValueError):
    pass


def resolve_expression(value: Any, context: dict[str, Any]) -> Any:
    if not isinstance(value, str):
        return value
    match = EXPRESSION_RE.match(value)
    if match is None:
        return value
    return resolve_path(match.group(1), context)


def resolve_path(path: str, context: dict[str, Any]) -> Any:
    current: Any = context
    for part in path.split("."):
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
