from pathlib import Path
from textwrap import dedent

from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import (
    Position,
    WorkflowDocument,
    WorkflowEdge,
    WorkflowNode,
    WorkflowSubflow,
)
from apps.api.nodeflow_api.validation import validate_workflow


def registry() -> NodeRegistry:
    node_registry = NodeRegistry(nodes_dir=Path("nodes"))
    node_registry.scan()
    return node_registry


def temp_required_input_registry(tmp_path: Path) -> NodeRegistry:
    (tmp_path / "test_nodes.py").write_text(
        dedent(
            """
            from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node


            @node(id="test.source", name="Source", category="Test", description="Emit a payload.")
            class SourceNode(BaseNode[NodeConfig]):
                outputs = {"success": Output(description="Payload")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": {"ok": True}}


            @node(id="test.required_sink", name="Required Sink", category="Test", description="Needs input.")
            class RequiredSinkNode(BaseNode[NodeConfig]):
                inputs = {"input": Input(required=True, description="Required input")}
                outputs = {"success": Output(description="Input passthrough")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": inputs}


            @node(id="test.optional_sink", name="Optional Sink", category="Test", description="Optional input.")
            class OptionalSinkNode(BaseNode[NodeConfig]):
                inputs = {"input": Input(required=False, description="Optional input")}
                outputs = {"success": Output(description="Input passthrough")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": inputs}


            @node(id="control.test_loop", name="Test Loop", category="Test", description="Owns a body subflow.")
            class TestLoopNode(BaseNode[NodeConfig]):
                outputs = {"success": Output(description="Done")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": inputs}
            """
        ),
        encoding="utf-8",
    )
    node_registry = NodeRegistry(nodes_dir=tmp_path)
    node_registry.scan()
    return node_registry


def position(x: float = 0, y: float = 0) -> Position:
    return Position(x=x, y=y)


def manual_node(node_id: str = "trigger") -> WorkflowNode:
    return WorkflowNode(id=node_id, type="manual.trigger", position=position())


def log_node(node_id: str = "log", x: float = 200) -> WorkflowNode:
    return WorkflowNode(
        id=node_id,
        type="utility.log",
        position=position(x=x),
        config={"message": "ok"},
    )


def issue_messages(result) -> list[str]:
    return [issue.message for issue in result.issues]


def issue_paths(result) -> list[str]:
    return [issue.path for issue in result.issues]


def test_validation_accepts_valid_simple_workflow():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[manual_node("a"), log_node("b")],
        edges=[
            WorkflowEdge(
                id="e1",
                source="a",
                sourceHandle="success",
                target="b",
                targetHandle="input",
            )
        ],
    )

    result = validate_workflow(workflow, registry())

    assert result.valid is True
    assert result.issues == []


def test_validation_rejects_unknown_node_type():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[WorkflowNode(id="a", type="missing.node", position=position())],
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
                position=position(),
                config={},
            )
        ],
        edges=[],
    )
    result = validate_workflow(workflow, registry())
    assert not result.valid
    assert "url" in result.issues[0].path or "url" in result.issues[0].message.lower()


def test_validation_reports_missing_config_field_path():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(
                id="http_1",
                type="http.request",
                position=position(),
                config={},
            )
        ],
        edges=[],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert result.issues[0].path == "nodes.http_1.config.url"


def test_validation_reports_extra_config_key_path():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(
                id="log",
                type="utility.log",
                position=position(),
                config={"message": "ok", "typo": True},
            )
        ],
        edges=[],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert result.issues[0].path == "nodes.log.config.typo"


def test_validation_rejects_invalid_edge_handle():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            manual_node("a"),
            log_node("b"),
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


def test_validation_rejects_duplicate_node_ids():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[manual_node("a"), log_node("a")],
        edges=[],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "Node IDs must be unique" in issue_messages(result)


def test_validation_rejects_duplicate_edge_ids():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[log_node("a"), log_node("b"), log_node("c")],
        edges=[
            WorkflowEdge(
                id="e1",
                source="a",
                sourceHandle="success",
                target="b",
                targetHandle="input",
            ),
            WorkflowEdge(
                id="e1",
                source="b",
                sourceHandle="success",
                target="c",
                targetHandle="input",
            ),
        ],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "Edge IDs must be unique" in issue_messages(result)


def test_validation_rejects_duplicate_edge_ids_inside_body_subflow():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(
                id="loop",
                type="control.foreach",
                position=position(),
                config={"items_expression": "items"},
                subflows={
                    "body": WorkflowSubflow(
                        nodes=[log_node("a"), log_node("b"), log_node("c")],
                        edges=[
                            WorkflowEdge(
                                id="e1",
                                source="a",
                                sourceHandle="success",
                                target="b",
                                targetHandle="input",
                            ),
                            WorkflowEdge(
                                id="e1",
                                source="b",
                                sourceHandle="success",
                                target="c",
                                targetHandle="input",
                            ),
                        ],
                    )
                },
            )
        ],
        edges=[],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "nodes.loop.subflows.body.edges" in issue_paths(result)
    assert "Edge IDs must be unique" in issue_messages(result)


def test_validation_rejects_unknown_source_node():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[log_node("b")],
        edges=[
            WorkflowEdge(
                id="e1",
                source="missing",
                sourceHandle="success",
                target="b",
                targetHandle="input",
            )
        ],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert result.issues[0].message == "Unknown source node: missing"


def test_validation_rejects_unknown_target_node():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[manual_node("a")],
        edges=[
            WorkflowEdge(
                id="e1",
                source="a",
                sourceHandle="success",
                target="missing",
                targetHandle="input",
            )
        ],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert result.issues[0].message == "Unknown target node: missing"


def test_validation_reports_unknown_source_and_target_nodes():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[],
        edges=[
            WorkflowEdge(
                id="e1",
                source="missing_source",
                sourceHandle="success",
                target="missing_target",
                targetHandle="input",
            )
        ],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "Unknown source node: missing_source" in issue_messages(result)
    assert "Unknown target node: missing_target" in issue_messages(result)


def test_validation_rejects_invalid_target_handle():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[manual_node("a"), log_node("b")],
        edges=[
            WorkflowEdge(
                id="e1",
                source="a",
                sourceHandle="success",
                target="b",
                targetHandle="missing",
            )
        ],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert result.issues[0].message == "Unknown target handle: missing"


def test_validation_rejects_missing_required_input(tmp_path):
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(id="sink", type="test.required_sink", position=position()),
        ],
        edges=[],
    )

    result = validate_workflow(workflow, temp_required_input_registry(tmp_path))

    assert not result.valid
    assert "nodes.sink.inputs.input" in issue_paths(result)
    assert "Missing required input: input" in issue_messages(result)


def test_validation_accepts_connected_required_input_and_unconnected_optional_input(tmp_path):
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(id="source", type="test.source", position=position()),
            WorkflowNode(id="required", type="test.required_sink", position=position(x=200)),
            WorkflowNode(id="optional", type="test.optional_sink", position=position(x=400)),
        ],
        edges=[
            WorkflowEdge(
                id="e1",
                source="source",
                sourceHandle="success",
                target="required",
                targetHandle="input",
            )
        ],
    )

    result = validate_workflow(workflow, temp_required_input_registry(tmp_path))

    assert result.valid is True
    assert result.issues == []


def test_validation_rejects_normal_graph_cycle():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[log_node("a"), log_node("b")],
        edges=[
            WorkflowEdge(
                id="e1",
                source="a",
                sourceHandle="success",
                target="b",
                targetHandle="input",
            ),
            WorkflowEdge(
                id="e2",
                source="b",
                sourceHandle="success",
                target="a",
                targetHandle="input",
            ),
        ],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "Workflow graph contains a cycle" in issue_messages(result)


def test_validation_accepts_long_acyclic_chain_without_recursion_error():
    nodes = [log_node(f"log_{index}", x=index) for index in range(1200)]
    edges = [
        WorkflowEdge(
            id=f"e{index}",
            source=f"log_{index}",
            sourceHandle="success",
            target=f"log_{index + 1}",
            targetHandle="input",
        )
        for index in range(len(nodes) - 1)
    ]
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=nodes,
        edges=edges,
    )

    result = validate_workflow(workflow, registry())

    assert result.valid is True
    assert result.issues == []


def test_validation_rejects_foreach_without_body_subflow():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(
                id="loop",
                type="control.foreach",
                position=position(),
                config={"items_expression": "items"},
            )
        ],
        edges=[],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "Control nodes require a body subflow" in issue_messages(result)


def test_validation_rejects_while_without_body_subflow():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(
                id="loop",
                type="control.while",
                position=position(),
                config={"condition": "keep_going"},
            )
        ],
        edges=[],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "Control nodes require a body subflow" in issue_messages(result)


def test_validation_prefixes_invalid_body_subflow_issue_path():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(
                id="loop",
                type="control.foreach",
                position=position(),
                config={"items_expression": "items"},
                subflows={
                    "body": WorkflowSubflow(
                        nodes=[
                            WorkflowNode(
                                id="nested",
                                type="missing.node",
                                position=position(),
                            )
                        ],
                        edges=[],
                    )
                },
            )
        ],
        edges=[],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert result.issues[0].path == "nodes.loop.subflows.body.nodes.nested"
    assert result.issues[0].message == "Unknown node type: missing.node"


def test_validation_rejects_missing_required_input_inside_body_subflow(tmp_path):
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(
                id="loop",
                type="control.test_loop",
                position=position(),
                subflows={
                    "body": WorkflowSubflow(
                        nodes=[
                            WorkflowNode(
                                id="nested",
                                type="test.required_sink",
                                position=position(),
                            )
                        ],
                        edges=[],
                    )
                },
            )
        ],
        edges=[],
    )

    result = validate_workflow(workflow, temp_required_input_registry(tmp_path))

    assert not result.valid
    assert "nodes.loop.subflows.body.nodes.nested.inputs.input" in issue_paths(result)
    assert "Missing required input: input" in issue_messages(result)


def test_validation_handles_edge_attached_to_unknown_node_type_without_raising():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(id="a", type="missing.node", position=position()),
            log_node("b"),
        ],
        edges=[
            WorkflowEdge(
                id="e1",
                source="a",
                sourceHandle="success",
                target="b",
                targetHandle="input",
            )
        ],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert result.issues[0].message == "Unknown node type: missing.node"


def test_validate_endpoint_returns_invalid_result_for_invalid_workflow():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    response = client.post(
        "/api/workflows/validate",
        json={
            "id": "wf_1",
            "name": "Demo",
            "nodes": [{"id": "a", "type": "missing.node", "position": {"x": 0, "y": 0}}],
            "edges": [],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is False
    assert payload["issues"][0]["message"] == "Unknown node type: missing.node"


def test_save_workflow_returns_422_with_issue_details_for_invalid_workflow():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    response = client.post(
        "/api/workflows",
        json={
            "id": "wf_1",
            "name": "Demo",
            "nodes": [{"id": "a", "type": "missing.node", "position": {"x": 0, "y": 0}}],
            "edges": [],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"][0] == {
        "path": "nodes.a",
        "message": "Unknown node type: missing.node",
    }
