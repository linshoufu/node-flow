from __future__ import annotations

from typing import Any

JsonSchema = dict[str, Any]

ANY_JSON_SCHEMA: JsonSchema = {
    "description": "Any JSON-compatible value.",
}

STRING_MAP_SCHEMA: JsonSchema = {
    "type": "object",
    "additionalProperties": {"type": "string"},
}

ERROR_SCHEMA: JsonSchema = {
    "type": "object",
    "properties": {
        "message": {"type": "string"},
        "type": {"type": "string"},
        "status_code": {"type": "integer", "minimum": 100, "maximum": 599},
        "body": ANY_JSON_SCHEMA,
        "path": {"type": "string"},
    },
}

HTTP_RESPONSE_SCHEMA: JsonSchema = {
    "type": "object",
    "properties": {
        "status_code": {"type": "integer", "minimum": 100, "maximum": 599},
        "headers": STRING_MAP_SCHEMA,
        "body": ANY_JSON_SCHEMA,
    },
    "required": ["status_code", "headers", "body"],
}

CSV_DATASET_SCHEMA: JsonSchema = {
    "type": "object",
    "properties": {
        "path": {"type": "string"},
        "headers": {"type": "array", "items": {"type": "string"}},
        "rows": {"type": "array", "items": {"type": "object"}},
        "columns": {
            "type": "object",
            "additionalProperties": {"type": "array", "items": ANY_JSON_SCHEMA},
        },
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "json": ANY_JSON_SCHEMA,
                    "binary": ANY_JSON_SCHEMA,
                    "pairedItem": ANY_JSON_SCHEMA,
                },
                "required": ["json"],
            },
        },
        "row_count": {"type": "integer", "minimum": 0},
    },
    "required": ["path", "headers", "rows", "columns", "row_count"],
}

EXECUTION_ITEMS_SCHEMA: JsonSchema = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "json": ANY_JSON_SCHEMA,
            "binary": ANY_JSON_SCHEMA,
            "pairedItem": ANY_JSON_SCHEMA,
        },
        "required": ["json"],
    },
}

ASSERTION_RESULT_SCHEMA: JsonSchema = {
    "type": "object",
    "properties": {
        "assertion": {"type": "string"},
        "status": {"type": "string", "enum": ["passed", "failed"]},
        "expected": ANY_JSON_SCHEMA,
        "actual": ANY_JSON_SCHEMA,
        "message": {"type": "string"},
        "path": {"type": "string"},
    },
    "required": ["assertion", "status", "message"],
}

TEST_REPORT_SCHEMA: JsonSchema = {
    "type": "object",
    "properties": {
        "summary": {
            "type": "object",
            "properties": {
                "total": {"type": "integer", "minimum": 0},
                "passed": {"type": "integer", "minimum": 0},
                "failed": {"type": "integer", "minimum": 0},
            },
            "required": ["total", "passed", "failed"],
        },
        "results": {"type": "array", "items": ASSERTION_RESULT_SCHEMA},
    },
    "required": ["summary", "results"],
}
