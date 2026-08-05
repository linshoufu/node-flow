from pathlib import Path

import pytest

from apps.api.nodeflow_api.executor import WorkflowExecutor
from apps.api.nodeflow_api.node_ports import resolved_input_ports
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowEdge, WorkflowNode
from apps.api.nodeflow_api.storage import Storage
from apps.api.nodeflow_api.workflow_connections import ConnectionValidationCode, validate_edge_connection
from apps.api.nodeflow_api.workflow_node_validation import node_definition_issues


def builtin_registry() -> NodeRegistry:
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    return registry


def collect_node(*, sources: list[dict[str, str]] | None = None) -> WorkflowNode:
    return WorkflowNode(
        id="collect",
        type="data.collect",
        position=Position(x=300, y=0),
        config={
            "sources": sources
            or [
                {"id": "left", "label": "左侧结果"},
                {"id": "right", "label": "右侧结果"},
            ]
        },
    )


def test_collect_node_exposes_configured_input_ports():
    registry = builtin_registry()
    node_type = registry.get("data.collect")
    node = collect_node()

    assert node_type.dynamic_inputs == {
        "configKey": "sources",
        "idKey": "id",
        "labelKey": "label",
        "input": {
            "required": True,
            "description": "Named value to collect",
            "schema": {"description": "Any JSON-compatible value."},
        },
        "defaultItems": [
            {"id": "input_1", "label": "输入 1"},
            {"id": "input_2", "label": "输入 2"},
        ],
    }
    assert resolved_input_ports(node, node_type) == {
        "left": {
            "required": True,
            "description": "Named value to collect",
            "displayName": "左侧结果",
            "schema": {"description": "Any JSON-compatible value."},
        },
        "right": {
            "required": True,
            "description": "Named value to collect",
            "displayName": "右侧结果",
            "schema": {"description": "Any JSON-compatible value."},
        },
    }


def test_collect_connection_validation_uses_configured_input_ports():
    registry = builtin_registry()
    source = WorkflowNode(
        id="source",
        type="manual.trigger",
        position=Position(x=0, y=0),
        config={"payload": {}},
    )
    collect = collect_node()
    node_by_id = {source.id: source, collect.id: collect}

    valid = validate_edge_connection(
        WorkflowEdge(id="valid", source="source", sourceHandle="success", target="collect", targetHandle="left"),
        node_by_id,
        registry,
        existing_edges=[],
    )
    stale = validate_edge_connection(
        WorkflowEdge(id="stale", source="source", sourceHandle="success", target="collect", targetHandle="missing"),
        node_by_id,
        registry,
        existing_edges=[],
    )

    assert valid.valid is True
    assert stale.code == ConnectionValidationCode.UNKNOWN_TARGET_PORT
    collect.config["sources"] = [{"id": "invalid-port", "label": "Invalid"}]
    assert node_definition_issues(collect, registry, "nodes.collect")[0][0] == "nodes.collect.config.sources.0.id"


def test_dynamic_port_metadata_validates_unconstrained_third_party_config(tmp_path: Path):
    (tmp_path / "dynamic_ports.py").write_text(
        '''
from typing import Any

from pydantic import Field

from nodeflow_sdk import BaseNode, DynamicInputList, Input, NodeConfig, NodeContext, Output, node


class DynamicConfig(NodeConfig):
    sources: list[dict[str, Any]] = Field(default_factory=list)


@node(
    id="example.dynamic_inputs",
    name="Dynamic Inputs",
    category="Example",
    dynamic_inputs=DynamicInputList(config_key="sources", input=Input()),
)
class DynamicInputsNode(BaseNode[DynamicConfig]):
    inputs = {"reserved": Input(required=False)}
    outputs = {"success": Output()}

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": inputs}
'''.lstrip(),
        encoding="utf-8",
    )
    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()
    node = WorkflowNode(
        id="dynamic",
        type="example.dynamic_inputs",
        position=Position(x=0, y=0),
        config={
            "sources": [
                {"id": "bad-port", "label": "Bad"},
                {"id": "reserved", "label": "Collision"},
                {"id": "same", "label": "First"},
                {"id": "same", "label": "Second"},
                {"id": "blank_label", "label": " "},
            ]
        },
    )

    assert node_definition_issues(node, registry, "nodes.dynamic") == [
        ("nodes.dynamic.config.sources.0.id", "动态输入端口 ID 必须匹配 ^[A-Za-z_][A-Za-z0-9_]*$"),
        ("nodes.dynamic.config.sources.1.id", "动态输入端口 ID 'reserved' 与已有端口重复"),
        ("nodes.dynamic.config.sources.3.id", "动态输入端口 ID 'same' 与已有端口重复"),
        ("nodes.dynamic.config.sources.4.label", "动态输入端口名称必须是非空字符串"),
    ]


@pytest.mark.asyncio
async def test_collect_node_runs_with_named_dynamic_inputs():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = builtin_registry()
    workflow = storage.save_workflow(
        WorkflowDocument(
            id="dynamic_collect",
            name="Dynamic collect",
            nodes=[
                WorkflowNode(
                    id="first",
                    type="manual.trigger",
                    position=Position(x=0, y=0),
                    config={"payload": {"id": "first"}},
                ),
                WorkflowNode(
                    id="second",
                    type="manual.trigger",
                    position=Position(x=0, y=160),
                    config={"payload": {"id": "second"}},
                ),
                collect_node(),
            ],
            edges=[
                WorkflowEdge(id="first_collect", source="first", sourceHandle="success", target="collect", targetHandle="left"),
                WorkflowEdge(id="second_collect", source="second", sourceHandle="success", target="collect", targetHandle="right"),
            ],
        )
    )
    run = storage.create_run(workflow)

    await WorkflowExecutor(storage=storage, registry=registry).execute(run.id, workflow)

    event = next(event for event in storage.list_events(run.id) if event.node_id == "collect" and event.type == "node_succeeded")
    assert storage.get_run(run.id).status == "succeeded"
    assert event.payload["outputs"] == {"output": {"left": {"id": "first"}, "right": {"id": "second"}}}
