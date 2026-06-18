from __future__ import annotations

from typing import Any


class DataPathError(ValueError):
    pass


def resolve_data_path(value: Any, path: str) -> Any:
    if path == "":
        return value

    current = value
    for part in path.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
            continue
        if isinstance(current, list) and part.isdigit():
            index = int(part)
            if index < len(current):
                current = current[index]
                continue
        raise DataPathError(f"Cannot resolve data path: {path}")
    return current
