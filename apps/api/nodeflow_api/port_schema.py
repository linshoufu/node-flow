from __future__ import annotations

from typing import Any

JsonSchema = dict[str, Any]


def schema_types(schema: JsonSchema | None) -> list[str]:
    if not schema:
        return []

    raw_type = schema.get("type")
    if isinstance(raw_type, str):
        return [raw_type] if raw_type != "null" else []
    if isinstance(raw_type, list):
        return [item for item in raw_type if isinstance(item, str) and item != "null"]

    for key in ("anyOf", "oneOf"):
        options = schema.get(key)
        if isinstance(options, list):
            return _unique(
                type_name
                for option in options
                if isinstance(option, dict)
                for type_name in schema_types(option)
            )

    all_of = schema.get("allOf")
    if isinstance(all_of, list):
        return _unique(
            type_name
            for part in all_of
            if isinstance(part, dict)
            for type_name in schema_types(part)
        )

    return []


def schemas_are_compatible(source_schema: JsonSchema | None, target_schema: JsonSchema | None) -> bool:
    source_types = schema_types(source_schema)
    target_types = schema_types(target_schema)

    if not source_types or not target_types:
        return True

    return any(_type_is_compatible(source_type, target_type) for source_type in source_types for target_type in target_types)


def schema_type_label(schema: JsonSchema | None) -> str:
    types = schema_types(schema)
    return " | ".join(types) if types else "any"


def _type_is_compatible(source_type: str, target_type: str) -> bool:
    return source_type == target_type or (source_type == "integer" and target_type == "number")


def _unique(values: Any) -> list[str]:
    result: list[str] = []
    for value in values:
        if value not in result:
            result.append(value)
    return result