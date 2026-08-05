from pathlib import Path
from textwrap import dedent

from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowEdge, WorkflowNode
from apps.api.nodeflow_api.workflow_connections import (
    ConnectionValidationCode,
    required_input_issues,
    validate_edge_connection,
    validate_workflow_connections,
    valid_connected_input_handles,
)


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


            @node(id="test.optional_number_sink", name="Optional Number Sink", category="Test")
            class OptionalNumberSinkNode(BaseNode[NodeConfig]):
                inputs = {"input": Input(required=False, description="Number", schema={"type": "number"})}
                outputs = {"success": Output(description="Done")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": inputs}


            @node(id="test.multi_number_sink", name="Multi Number Sink", category="Test")
            class MultiNumberSinkNode(BaseNode[NodeConfig]):
                inputs = {"items": Input(required=False, description="Numbers", schema={"type": "number"}, max_connections=None)}
                outputs = {"success": Output(description="Done")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": inputs}


            @node(id="test.integer_source", name="Integer Source", category="Test")
            class IntegerSourceNode(BaseNode[NodeConfig]):
                outputs = {"success": Output(description="Integer", schema={"type": "integer"})}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": 1}


            @node(id="test.resource_source", name="Resource Source", category="Test")
            class ResourceSourceNode(BaseNode[NodeConfig]):
                outputs = {"success": Output(description="Resource", connection_kind="resource", schema={"type": "string"})}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": "resource"}


            @node(id="test.tool_sink", name="Tool Sink", category="Test")
            class ToolSinkNode(BaseNode[NodeConfig]):
                inputs = {"input": Input(required=True, description="Tool", connection_kind="tool", schema={"type": "string"})}
                outputs = {"success": Output(description="Done")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": inputs}


            @node(id="test.filtered_source", name="Filtered Source", category="Test")
            class FilteredSourceNode(BaseNode[NodeConfig]):
                outputs = {"success": Output(description="Filtered", filter={"nodes": ["test.number_sink"]})}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": "filtered"}


            @node(id="test.filtered_sink", name="Filtered Sink", category="Test")
            class FilteredSinkNode(BaseNode[NodeConfig]):
                inputs = {"input": Input(required=True, description="Filtered", filter={"nodes": ["test.integer_source"], "excludedNodes": ["test.text_source"]})}
                outputs = {"success": Output(description="Done")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": inputs}


            @node(id="test.limited_source", name="Limited Source", category="Test")
            class LimitedSourceNode(BaseNode[NodeConfig]):
                outputs = {"success": Output(description="One downstream node", max_connections=1)}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": "limited"}
            """
        ),
        encoding="utf-8",
    )
    node_registry = NodeRegistry(nodes_dir=tmp_path)
    node_registry.scan()
    return node_registry


def node(node_id: str, node_type: str) -> WorkflowNode:
    return WorkflowNode(id=node_id, type=node_type, position=Position(x=0, y=0))


def edge(edge_id: str, source: str, target: str) -> WorkflowEdge:
    return WorkflowEdge(
        id=edge_id,
        source=source,
        sourceHandle="success",
        target=target,
        targetHandle="input",
    )


def edge_to_handle(edge_id: str, source: str, target: str, target_handle: str) -> WorkflowEdge:
    return WorkflowEdge(
        id=edge_id,
        source=source,
        sourceHandle="success",
        target=target,
        targetHandle=target_handle,
    )


def test_validate_workflow_connections_reports_duplicates_and_occupied_inputs(tmp_path):
    registry = temp_typed_port_registry(tmp_path)
    node_by_id = {
        "a": node("a", "test.integer_source"),
        "b": node("b", "test.number_sink"),
        "c": node("c", "test.integer_source"),
    }
    issues = validate_workflow_connections(
        [
            edge("e1", "a", "b"),
            edge("e2", "a", "b"),
            edge("e3", "c", "b"),
        ],
        node_by_id,
        registry,
    )

    assert [(issue.path, issue.result.code, issue.result.message) for issue in issues] == [
        (
            "edges.e2",
            ConnectionValidationCode.DUPLICATE_CONNECTION,
            "Duplicate edge connection: a.success -> b.input",
        ),
        (
            "edges.e3.targetHandle",
            ConnectionValidationCode.INPUT_ALREADY_CONNECTED,
            "Input handle already connected: b.input",
        ),
    ]


def test_validate_workflow_connections_allows_declared_multi_connection_inputs(tmp_path):
    registry = temp_typed_port_registry(tmp_path)
    node_by_id = {
        "a": node("a", "test.integer_source"),
        "c": node("c", "test.integer_source"),
        "sink": node("sink", "test.multi_number_sink"),
    }

    issues = validate_workflow_connections(
        [
            edge_to_handle("e1", "a", "sink", "items"),
            edge_to_handle("e2", "c", "sink", "items"),
        ],
        node_by_id,
        registry,
    )

    assert issues == []


def test_validate_workflow_connections_reports_schema_incompatibility(tmp_path):
    registry = temp_typed_port_registry(tmp_path)
    node_by_id = {
        "source": node("source", "test.text_source"),
        "sink": node("sink", "test.number_sink"),
    }

    issues = validate_workflow_connections([edge("e1", "source", "sink")], node_by_id, registry)

    assert [(issue.path, issue.result.code, issue.result.message) for issue in issues] == [
        (
            "edges.e1",
            ConnectionValidationCode.INCOMPATIBLE_SCHEMA,
            "Incompatible port schemas: source.success string -> sink.input number",
        )
    ]


def test_validate_edge_connection_returns_structured_schema_error(tmp_path):
    registry = temp_typed_port_registry(tmp_path)
    node_by_id = {
        "source": node("source", "test.text_source"),
        "sink": node("sink", "test.number_sink"),
    }

    result = validate_edge_connection(
        edge("e1", "source", "sink"),
        node_by_id,
        registry,
        existing_edges=[],
    )

    assert result.valid is False
    assert result.code == ConnectionValidationCode.INCOMPATIBLE_SCHEMA
    assert result.source_port == "success"
    assert result.target_port == "input"
    assert result.source_schema_label == "string"
    assert result.target_schema_label == "number"
    assert result.message == "Incompatible port schemas: source.success string -> sink.input number"


def test_validate_edge_connection_allows_integer_to_number_schema(tmp_path):
    registry = temp_typed_port_registry(tmp_path)
    node_by_id = {
        "source": node("source", "test.integer_source"),
        "sink": node("sink", "test.number_sink"),
    }

    result = validate_edge_connection(
        edge("e1", "source", "sink"),
        node_by_id,
        registry,
        existing_edges=[],
    )

    assert result.valid is True
    assert result.code is None


def test_item_mode_input_accepts_legacy_json_outputs_without_schema_rejection():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    node_by_id = {
        "source": node("source", "data.csv_read"),
        "loop": node("loop", "control.each_item"),
    }
    item_edge = WorkflowEdge(
        id="csv_dataset_to_item_loop",
        source="source",
        sourceHandle="success",
        target="loop",
        targetHandle="items",
    )

    result = validate_edge_connection(item_edge, node_by_id, registry, existing_edges=[])

    assert result.valid is True
    assert result.code is None


def test_validate_edge_connection_rejects_different_connection_kinds(tmp_path):
    registry = temp_typed_port_registry(tmp_path)
    node_by_id = {
        "source": node("source", "test.resource_source"),
        "sink": node("sink", "test.tool_sink"),
    }

    result = validate_edge_connection(
        edge("e1", "source", "sink"),
        node_by_id,
        registry,
        existing_edges=[],
    )

    assert result.valid is False
    assert result.code == ConnectionValidationCode.INCOMPATIBLE_CONNECTION_KIND
    assert result.source_connection_kind == "resource"
    assert result.target_connection_kind == "tool"
    assert result.message == "Incompatible connection kinds: source.success resource -> sink.input tool"


def test_validate_edge_connection_enforces_output_and_input_node_filters(tmp_path):
    registry = temp_typed_port_registry(tmp_path)

    output_filtered = validate_edge_connection(
        edge("output-filter", "source", "sink"),
        {
            "source": node("source", "test.filtered_source"),
            "sink": node("sink", "test.optional_number_sink"),
        },
        registry,
        existing_edges=[],
    )
    assert output_filtered.valid is False
    assert output_filtered.code == ConnectionValidationCode.OUTPUT_PORT_FILTER_REJECTED
    assert output_filtered.message == "Output port filter rejects target node type: source.success -> test.optional_number_sink"

    input_filtered = validate_edge_connection(
        edge("input-filter", "source", "sink"),
        {
            "source": node("source", "test.text_source"),
            "sink": node("sink", "test.filtered_sink"),
        },
        registry,
        existing_edges=[],
    )
    assert input_filtered.valid is False
    assert input_filtered.code == ConnectionValidationCode.INPUT_PORT_FILTER_REJECTED
    assert input_filtered.message == "Input port filter rejects source node type: test.text_source -> sink.input"

    accepted = validate_edge_connection(
        edge("accepted-filter", "source", "sink"),
        {
            "source": node("source", "test.integer_source"),
            "sink": node("sink", "test.filtered_sink"),
        },
        registry,
        existing_edges=[],
    )
    assert accepted.valid is True


def test_validate_edge_connection_enforces_explicit_output_connection_limit(tmp_path):
    registry = temp_typed_port_registry(tmp_path)
    node_by_id = {
        "source": node("source", "test.limited_source"),
        "first": node("first", "test.optional_number_sink"),
        "second": node("second", "test.optional_number_sink"),
    }
    first = edge("first-edge", "source", "first")

    result = validate_edge_connection(
        edge("second-edge", "source", "second"),
        node_by_id,
        registry,
        existing_edges=[first],
    )

    assert result.valid is False
    assert result.code == ConnectionValidationCode.OUTPUT_CONNECTION_LIMIT_REACHED
    assert result.message == "Output handle connection limit reached: source.success"


def test_filtered_connections_do_not_satisfy_required_inputs(tmp_path):
    registry = temp_typed_port_registry(tmp_path)
    nodes = [
        node("source", "test.text_source"),
        node("sink", "test.filtered_sink"),
    ]
    node_by_id = {item.id: item for item in nodes}

    assert required_input_issues(nodes, [edge("filtered", "source", "sink")], node_by_id, registry) == [
        ("nodes.sink.inputs.input", "Missing required input: input")
    ]


def test_validate_workflow_connections_returns_structured_multi_issue_results(tmp_path):
    registry = temp_typed_port_registry(tmp_path)
    missing_edge = WorkflowEdge(
        id="missing",
        source="missing.source",
        sourceHandle="success",
        target="missing.target",
        targetHandle="input",
    )
    schema_edge = WorkflowEdge(
        id="schema",
        source="source.with.dot",
        sourceHandle="success",
        target="sink",
        targetHandle="input",
    )
    node_by_id = {
        "source.with.dot": node("source.with.dot", "test.text_source"),
        "sink": node("sink", "test.number_sink"),
    }

    issues = validate_workflow_connections([missing_edge, schema_edge], node_by_id, registry)

    assert [(issue.path, issue.result.code) for issue in issues] == [
        ("edges.missing.source", ConnectionValidationCode.UNKNOWN_SOURCE_NODE),
        ("edges.missing.target", ConnectionValidationCode.UNKNOWN_TARGET_NODE),
        ("edges.schema", ConnectionValidationCode.INCOMPATIBLE_SCHEMA),
    ]
    schema_issue = issues[-1].result
    assert schema_issue.source_port == "success"
    assert schema_issue.target_port == "input"
    assert schema_issue.source_schema_label == "string"
    assert schema_issue.target_schema_label == "number"


def test_valid_connected_input_handles_only_counts_usable_edges(tmp_path):
    registry = temp_typed_port_registry(tmp_path)
    node_by_id = {
        "text": node("text", "test.text_source"),
        "integer": node("integer", "test.integer_source"),
        "sink": node("sink", "test.number_sink"),
    }

    connected_handles = valid_connected_input_handles(
        [
            edge("bad", "text", "sink"),
            edge("good", "integer", "sink"),
        ],
        node_by_id,
        registry,
    )

    assert connected_handles == {("sink", "input")}


def test_required_input_issues_report_only_unconnected_required_inputs(tmp_path):
    registry = temp_typed_port_registry(tmp_path)
    nodes = [
        node("integer", "test.integer_source"),
        node("connected", "test.number_sink"),
        node("missing", "test.number_sink"),
        node("optional", "test.optional_number_sink"),
    ]
    node_by_id = {item.id: item for item in nodes}

    issues = required_input_issues(
        nodes,
        [edge("good", "integer", "connected")],
        node_by_id,
        registry,
    )

    assert issues == [("nodes.missing.inputs.input", "Missing required input: input")]
