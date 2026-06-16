from pathlib import Path

from apps.api.nodeflow_api.node_registry import NodeRegistry


def test_registry_discovers_builtin_nodes():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    node_ids = {node.id for node in registry.list_node_types()}
    assert "manual.trigger" in node_ids
    assert "http.request" in node_ids
    assert "logic.if" in node_ids
    assert "control.foreach" in node_ids
    assert "control.while" in node_ids


def test_registry_returns_json_schema_for_config():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    node_type = registry.get("http.request")
    assert node_type.config_schema["properties"]["url"]["title"] == "URL"
    assert node_type.outputs["success"]["description"] == "Response data"
