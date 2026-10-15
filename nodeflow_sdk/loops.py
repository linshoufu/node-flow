"""Public result envelope emitted by item loops with an explicit return node."""

LOOP_RESULTS_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "index": {"type": "integer", "minimum": 0},
            "item": {},
            "status": {"type": "string", "enum": ["succeeded", "failed", "unverified"]},
            "reason": {"type": "string"},
            "output": {},
            "error": {"type": "string"},
        },
        "required": ["index", "item", "status"],
    },
}
