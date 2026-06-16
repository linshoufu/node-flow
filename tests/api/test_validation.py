from pathlib import Path

from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowEdge, WorkflowNode
from apps.api.nodeflow_api.validation import validate_workflow


def registry() -> NodeRegistry:
    node_registry = NodeRegistry(nodes_dir=Path("nodes"))
    node_registry.scan()
    return node_registry


def test_validation_rejects_unknown_node_type():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[WorkflowNode(id="a", type="missing.node", position=Position(x=0, y=0))],
        edges=[],
    )
    result = validate_workflow(workflow, registry())
    assert not result.valid
    assert result.issues[0].message == "Unknown node type: missing.node"


def test_validation_rejects_invalid_config():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(
                id="http_1",
                type="http.request",
                position=Position(x=0, y=0),
                config={},
            )
        ],
        edges=[],
    )
    result = validate_workflow(workflow, registry())
    assert not result.valid
    assert "url" in result.issues[0].message.lower()


def test_validation_rejects_invalid_edge_handle():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(id="a", type="manual.trigger", position=Position(x=0, y=0)),
            WorkflowNode(
                id="b",
                type="utility.log",
                position=Position(x=200, y=0),
                config={"message": "ok"},
            ),
        ],
        edges=[
            WorkflowEdge(
                id="e1",
                source="a",
                sourceHandle="missing",
                target="b",
                targetHandle="input",
            )
        ],
    )
    result = validate_workflow(workflow, registry())
    assert not result.valid
    assert result.issues[0].message == "Unknown source handle: missing"
