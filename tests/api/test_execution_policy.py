from apps.api.nodeflow_api.execution_policy import (
    DEFAULT_NODE_EXECUTION_POLICY,
    node_execution_error,
    normalize_node_execution_policy,
)


def test_legacy_node_execution_policy_uses_stop_defaults():
    policy = normalize_node_execution_policy(None)

    assert policy.model_dump(by_alias=True) == DEFAULT_NODE_EXECUTION_POLICY


def test_node_execution_error_is_structured_and_json_safe():
    error = node_execution_error(
        RuntimeError("boom"),
        attempt=2,
        node_id="request",
        scope=["each", "iteration:1"],
        timestamp="2026-07-17T00:00:00+00:00",
    )

    assert error.model_dump(by_alias=True) == {
        "message": "boom",
        "type": "RuntimeError",
        "attempt": 2,
        "nodeId": "request",
        "scope": ["each", "iteration:1"],
        "timestamp": "2026-07-17T00:00:00+00:00",
    }
