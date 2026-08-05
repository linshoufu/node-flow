from __future__ import annotations

from typing import Any


def normalize_execution_items(value: Any) -> list[dict[str, Any]]:
    """Return the stable item envelope used by node-run events.

    Nodes may continue returning ordinary JSON values. Item-aware nodes can return
    ``{"json": ..., "binary": ..., "pairedItem": ...}`` values directly.
    """

    values = value if isinstance(value, list) else [value]
    return [_normalize_execution_item(item) for item in values]


def normalize_port_execution_items(values: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return {name: normalize_execution_items(value) for name, value in values.items()}


def _normalize_execution_item(value: Any) -> dict[str, Any]:
    if isinstance(value, dict) and any(key in value for key in ("json", "binary", "pairedItem")):
        item: dict[str, Any] = {"json": value.get("json")}
        if "binary" in value:
            item["binary"] = value["binary"]
        if "pairedItem" in value:
            item["pairedItem"] = value["pairedItem"]
        return item
    return {"json": value}
