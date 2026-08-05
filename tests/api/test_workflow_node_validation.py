from pathlib import Path

from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowNode
from apps.api.nodeflow_api.workflow_node_validation import node_definition_issues


def registry() -> NodeRegistry:
    node_registry = NodeRegistry(nodes_dir=Path("nodes"))
    node_registry.scan()
    return node_registry


def node(node_id: str, node_type: str, config: dict | None = None) -> WorkflowNode:
    return WorkflowNode(
        id=node_id,
        type=node_type,
        position=Position(x=0, y=0),
        config=config or {},
    )


def test_node_definition_issues_report_unknown_node_type():
    issues = node_definition_issues(node("missing", "missing.node"), registry(), "nodes.missing")

    assert issues == [("nodes.missing", "Unknown node type: missing.node")]


def test_node_definition_issues_report_config_field_paths():
    issues = node_definition_issues(node("http", "http.request"), registry(), "nodes.http")

    assert issues[0][0] == "nodes.http.config.url"


def test_node_definition_issues_report_control_nodes_without_body_subflow():
    issues = node_definition_issues(
        node("loop", "control.foreach", {"items_expression": "items"}),
        registry(),
        "nodes.loop",
    )

    assert ("nodes.loop.subflows", "Control nodes require a body subflow") in issues
