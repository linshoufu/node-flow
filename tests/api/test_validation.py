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
    WorkflowSettings,
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

def temp_typed_port_registry(tmp_path: Path) -> NodeRegistry:
    (tmp_path / "typed_nodes.py").write_text(
        dedent(
            """
            from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node


            @node(id="test.text_source", name="Text Source", category="Test")
            class TextSourceNode(BaseNode[NodeConfig]):
                outputs = {"success": Output(description="Text", schema={"type": "string"})}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": "hello"}


            @node(id="test.number_sink", name="Number Sink", category="Test")
            class NumberSinkNode(BaseNode[NodeConfig]):
                inputs = {"input": Input(required=True, description="Number", schema={"type": "number"})}
                outputs = {"success": Output(description="Done")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": inputs}


            @node(id="test.integer_source", name="Integer Source", category="Test")
            class IntegerSourceNode(BaseNode[NodeConfig]):
                outputs = {"success": Output(description="Integer", schema={"type": "integer"})}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": 1}
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


def test_validation_rejects_duplicate_webhook_method_and_path():
    workflow = WorkflowDocument(
        id="wf_webhook_duplicate",
        name="Webhook duplicate",
        nodes=[
            WorkflowNode(
                id="webhook_orders",
                type="webhook.trigger",
                position=position(),
                config={"method": "POST", "path": "hooks/orders"},
            ),
            WorkflowNode(
                id="webhook_orders_again",
                type="webhook.trigger",
                position=position(200),
                config={"method": "POST", "path": "hooks/orders"},
            ),
        ],
        edges=[],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "nodes.webhook_orders_again.config.path" in issue_paths(result)
    assert any("Webhook endpoint POST /hooks/orders" in message for message in issue_messages(result))


def test_validation_rejects_a_webhook_trigger_with_an_incoming_connection():
    workflow = WorkflowDocument(
        id="wf_webhook_not_entry",
        name="Webhook must be an entry",
        nodes=[
            manual_node("manual"),
            WorkflowNode(
                id="webhook",
                type="webhook.trigger",
                position=position(200),
                config={"method": "POST", "path": "hooks/orders"},
            ),
        ],
        edges=[
            WorkflowEdge(
                id="manual_to_webhook",
                source="manual",
                sourceHandle="success",
                target="webhook",
                targetHandle="input",
            )
        ],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "edges.manual_to_webhook.target" in issue_paths(result)
    assert any("Webhook trigger must not have incoming connections" in message for message in issue_messages(result))


def test_validation_rejects_a_schedule_trigger_with_an_incoming_connection():
    workflow = WorkflowDocument(
        id="wf_schedule_not_entry",
        name="Schedule must be an entry",
        nodes=[
            manual_node("manual"),
            WorkflowNode(
                id="schedule",
                type="schedule.trigger",
                position=position(200),
                config={"interval_seconds": 60},
            ),
        ],
        edges=[
            WorkflowEdge(
                id="manual_to_schedule",
                source="manual",
                sourceHandle="success",
                target="schedule",
                targetHandle="input",
            )
        ],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "nodes.schedule" in issue_paths(result)
    assert any("Schedule trigger must not have incoming connections" in message for message in issue_messages(result))


def test_validation_rejects_a_schedule_trigger_inside_a_subflow():
    workflow = WorkflowDocument(
        id="wf_schedule_subflow",
        name="Schedule in subflow",
        nodes=[
            WorkflowNode(
                id="each",
                type="control.each_item",
                position=position(),
                config={"max_items": 10},
                subflows={
                    "body": WorkflowSubflow(
                        nodes=[
                            WorkflowNode(
                                id="schedule",
                                type="schedule.trigger",
                                position=position(),
                                config={"interval_seconds": 60},
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
    assert any(
        issue.path == "nodes.each.subflows.body.nodes.schedule"
        and "Schedule trigger can only be used in a top-level workflow" in issue.message
        for issue in result.issues
    )


def test_validation_rejects_webhook_response_on_a_manual_workflow_path():
    workflow = WorkflowDocument(
        id="wf_manual_webhook_response",
        name="Manual response",
        nodes=[
            manual_node("manual"),
            WorkflowNode(
                id="respond",
                type="webhook.respond",
                position=position(200),
                config={"status_code": 200, "headers": {}},
            ),
        ],
        edges=[
            WorkflowEdge(
                id="manual_to_respond",
                source="manual",
                sourceHandle="success",
                target="respond",
                targetHandle="input",
            )
        ],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "nodes.respond" in issue_paths(result)
    assert any("Webhook response nodes require a Webhook trigger" in message for message in issue_messages(result))


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


def test_validation_rejects_self_and_missing_error_workflow_references():
    self_referencing = WorkflowDocument(
        id="wf_self_error_handler",
        name="Self handler",
        settings=WorkflowSettings(error_workflow_id="wf_self_error_handler"),
        nodes=[],
        edges=[],
    )
    missing_referencing = WorkflowDocument(
        id="wf_missing_error_handler",
        name="Missing handler",
        settings=WorkflowSettings(error_workflow_id="wf_not_saved"),
        nodes=[],
        edges=[],
    )

    self_result = validate_workflow(self_referencing, registry())
    missing_result = validate_workflow(missing_referencing, registry(), error_workflow_lookup=lambda _: None)

    assert any(issue.code == "error_workflow_self_reference" for issue in self_result.issues)
    assert any(issue.code == "error_workflow_not_found" for issue in missing_result.issues)


def test_validation_requires_error_workflow_to_start_with_workflow_trigger():
    error_handler = WorkflowDocument(
        id="wf_invalid_error_handler",
        name="Invalid handler",
        nodes=[WorkflowNode(id="manual", type="manual.trigger", position=position(), config={})],
        edges=[],
    )
    workflow = WorkflowDocument(
        id="wf_parent_error_handler",
        name="Parent",
        settings=WorkflowSettings(error_workflow_id=error_handler.id),
        nodes=[],
        edges=[],
    )

    result = validate_workflow(workflow, registry(), error_workflow_lookup=lambda _: error_handler)

    assert any(issue.code == "error_workflow_invalid_trigger" for issue in result.issues)


def test_validation_rejects_pinned_data_for_an_unknown_output_port():
    workflow = WorkflowDocument(
        id="wf_invalid_pinned_output",
        name="Invalid pinned output",
        nodes=[
            WorkflowNode(
                id="log",
                type="utility.log",
                position=position(),
                config={"message": "ok"},
                pinnedData={"missing": {"value": True}},
            )
        ],
        edges=[],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "nodes.log.pinnedData.missing" in issue_paths(result)
    assert any("不存在的输出端口" in message for message in issue_messages(result))


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


def test_validation_rejects_invalid_workflow_setting_variable_names():
    workflow = WorkflowDocument(
        id="wf_invalid_variables",
        name="Invalid Variables",
        settings={"variables": {"base-url": "https://api.example.com", "2token": "secret"}},
        nodes=[],
        edges=[],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "settings.variables.base-url" in issue_paths(result)
    assert "settings.variables.2token" in issue_paths(result)
    assert all("变量名" in message for message in issue_messages(result))


def test_validation_rejects_workflow_timeout_above_one_day():
    workflow = WorkflowDocument(
        id="wf_timeout_too_large",
        name="Timeout Too Large",
        settings={"timeout_seconds": 86401},
        nodes=[],
        edges=[],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "settings.timeout_seconds" in issue_paths(result)
    assert "Workflow timeout must be between 1 and 86400 seconds" in issue_messages(result)


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


def test_validation_reports_unknown_source_and_target_handles():
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
                sourceHandle="missing_source",
                target="b",
                targetHandle="missing_target",
            )
        ],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "Unknown source handle: missing_source" in issue_messages(result)
    assert "Unknown target handle: missing_target" in issue_messages(result)


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


def test_validation_rejects_duplicate_edge_connections():
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
            ),
            WorkflowEdge(
                id="e2",
                source="a",
                sourceHandle="success",
                target="b",
                targetHandle="input",
            ),
        ],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "edges.e2" in issue_paths(result)
    assert "Duplicate edge connection: a.success -> b.input" in issue_messages(result)


def test_validation_rejects_occupied_input_port():
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[manual_node("a"), manual_node("c"), log_node("b")],
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
                source="c",
                sourceHandle="success",
                target="b",
                targetHandle="input",
            ),
        ],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert "edges.e2.targetHandle" in issue_paths(result)
    assert "Input handle already connected: b.input" in issue_messages(result)

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


def test_validation_rejects_incompatible_edge_port_schemas(tmp_path):
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(id="source", type="test.text_source", position=position()),
            WorkflowNode(id="sink", type="test.number_sink", position=position(x=200)),
        ],
        edges=[
            WorkflowEdge(
                id="e1",
                source="source",
                sourceHandle="success",
                target="sink",
                targetHandle="input",
            )
        ],
    )

    result = validate_workflow(workflow, temp_typed_port_registry(tmp_path))

    assert not result.valid
    assert "edges.e1" in issue_paths(result)
    assert "nodes.sink.inputs.input" in issue_paths(result)
    assert "Incompatible port schemas: source.success string -> sink.input number" in issue_messages(result)
    assert "Missing required input: input" in issue_messages(result)
    connection_issue = next(issue for issue in result.issues if issue.path == "edges.e1")
    assert connection_issue.code == "incompatible_schema"
    assert connection_issue.details == {
        "source_port": "success",
        "target_port": "input",
        "source_schema_label": "string",
        "target_schema_label": "number",
    }


def test_validation_uses_structured_connection_details_when_node_ids_contain_dots(tmp_path):
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(id="source.with.dot", type="test.text_source", position=position()),
            WorkflowNode(id="sink", type="test.number_sink", position=position(x=200)),
        ],
        edges=[
            WorkflowEdge(
                id="e1",
                source="source.with.dot",
                sourceHandle="success",
                target="sink",
                targetHandle="input",
            )
        ],
    )

    result = validate_workflow(workflow, temp_typed_port_registry(tmp_path))

    connection_issue = next(issue for issue in result.issues if issue.path == "edges.e1")
    assert connection_issue.code == "incompatible_schema"
    assert connection_issue.details == {
        "source_port": "success",
        "target_port": "input",
        "source_schema_label": "string",
        "target_schema_label": "number",
    }


def test_save_workflow_returns_422_with_connection_issue_code(tmp_path):
    temp_typed_port_registry(tmp_path)
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))

    response = client.post(
        "/api/workflows",
        json={
            "id": "wf_1",
            "name": "Demo",
            "nodes": [
                {"id": "source", "type": "test.text_source", "position": {"x": 0, "y": 0}},
                {"id": "sink", "type": "test.number_sink", "position": {"x": 200, "y": 0}},
            ],
            "edges": [
                {
                    "id": "e1",
                    "source": "source",
                    "sourceHandle": "success",
                    "target": "sink",
                    "targetHandle": "input",
                }
            ],
        },
    )

    assert response.status_code == 422
    connection_issue = next(issue for issue in response.json()["detail"] if issue["path"] == "edges.e1")
    assert connection_issue["code"] == "incompatible_schema"
    assert connection_issue["details"] == {
        "source_port": "success",
        "target_port": "input",
        "source_schema_label": "string",
        "target_schema_label": "number",
    }


def test_validation_accepts_integer_output_connected_to_number_input(tmp_path):
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(id="source", type="test.integer_source", position=position()),
            WorkflowNode(id="sink", type="test.number_sink", position=position(x=200)),
        ],
        edges=[
            WorkflowEdge(
                id="e1",
                source="source",
                sourceHandle="success",
                target="sink",
                targetHandle="input",
            )
        ],
    )

    result = validate_workflow(workflow, temp_typed_port_registry(tmp_path))

    assert result.valid is True
    assert result.issues == []

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


def test_validation_does_not_count_invalid_edges_as_required_inputs(tmp_path):
    workflow = WorkflowDocument(
        id="wf_1",
        name="Demo",
        nodes=[
            WorkflowNode(id="source", type="test.source", position=position()),
            WorkflowNode(id="sink", type="test.required_sink", position=position(x=200)),
        ],
        edges=[
            WorkflowEdge(
                id="e1",
                source="source",
                sourceHandle="missing",
                target="sink",
                targetHandle="input",
            )
        ],
    )

    result = validate_workflow(workflow, temp_required_input_registry(tmp_path))

    assert not result.valid
    assert "Unknown source handle: missing" in issue_messages(result)
    assert "nodes.sink.inputs.input" in issue_paths(result)
    assert "Missing required input: input" in issue_messages(result)

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


def test_validation_skips_runtime_configuration_checks_for_disabled_nodes(tmp_path):
    workflow = WorkflowDocument(
        id="wf_disabled_node",
        name="Disabled node",
        nodes=[
            WorkflowNode(
                id="disabled_sink",
                type="test.required_sink",
                position=position(),
                disabled=True,
                config={"unexpected": "value"},
            )
        ],
        edges=[],
    )

    result = validate_workflow(workflow, temp_required_input_registry(tmp_path))

    assert result.valid is True
    assert result.issues == []


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


def test_validation_rejects_invalid_expression_syntax_in_config():
    workflow = WorkflowDocument(
        id="wf_expression_syntax",
        name="Expression Syntax",
        nodes=[
            WorkflowNode(
                id="transform",
                type="utility.transform",
                position=position(),
                config={"value": "{{ inputs.input. }}"},
            )
        ],
        edges=[],
    )

    result = validate_workflow(workflow, registry())

    assert not result.valid
    assert result.issues[-1].path == "nodes.transform.config.value"
    assert (
        result.issues[-1].message
        == "表达式语法无效：{{ inputs.input. }}。请使用 {{ nodes.request.outputs.success }} 这样的路径格式。"
    )


def test_validation_reports_nested_error_output_policy_without_error_port():
    workflow = WorkflowDocument(
        id="wf_nested_error_policy",
        name="Nested error policy",
        nodes=[
            WorkflowNode(
                id="loop",
                type="control.foreach",
                position=position(),
                config={"items_expression": "{{ inputs.items }}"},
                subflows={
                    "body": WorkflowSubflow(
                        nodes=[
                            WorkflowNode(
                                id="nested",
                                type="manual.trigger",
                                position=position(),
                                execution={"onError": "errorOutput"},
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
    assert any(
        issue.path == "nodes.loop.subflows.body.nodes.nested.execution.onError"
        and issue.message == "错误端口策略要求节点声明并连接 error 输出端口"
        for issue in result.issues
    )
