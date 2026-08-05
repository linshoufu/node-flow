from pathlib import Path

import pytest

from apps.api.nodeflow_api.executor import WorkflowExecutor
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowEdge, WorkflowNode
from apps.api.nodeflow_api.storage import Storage
from apps.api.nodeflow_api.workflow_connections import ConnectionValidationCode, validate_edge_connection
from apps.api.nodeflow_api.workflow_node_validation import node_definition_issues


def builtin_registry() -> NodeRegistry:
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    return registry


def switch_node(*, pinned_data: dict | None = None) -> WorkflowNode:
    return WorkflowNode(
        id="switch",
        type="logic.switch",
        position=Position(x=200, y=0),
        config={
            "rules": [
                {"id": "matched", "label": "命中目标", "value": "yes"},
                {"id": "other", "label": "其他值", "value": "no"},
            ]
        },
        pinnedData=pinned_data,
    )


def test_switch_node_exposes_configured_output_ports():
    registry = builtin_registry()
    switch_type = registry.get("logic.switch")

    assert switch_type.dynamic_outputs == {
        "configKey": "rules",
        "idKey": "id",
        "labelKey": "label",
        "output": {
            "description": "Matched route input",
            "schema": {"description": "Any JSON-compatible value."},
        },
        "defaultItems": [
            {"id": "route_1", "label": "匹配值 1", "value": "value_1"},
            {"id": "route_2", "label": "匹配值 2", "value": "value_2"},
        ],
    }
    assert switch_type.node_class.output_ports(switch_node().config).keys() == {"matched", "other", "fallback"}


def test_switch_schema_exposes_default_route_rules_for_new_nodes():
    registry = builtin_registry()
    rules = registry.get("logic.switch").config_schema["properties"]["rules"]

    assert rules["default"] == [
        {"id": "route_1", "label": "匹配值 1", "value": "value_1"},
        {"id": "route_2", "label": "匹配值 2", "value": "value_2"},
    ]


def test_switch_connection_and_pinned_data_use_configured_output_ports():
    registry = builtin_registry()
    switch = switch_node(pinned_data={"matched": {"input": "yes"}})
    sink = WorkflowNode(
        id="sink",
        type="utility.log",
        position=Position(x=400, y=0),
        config={"message": "命中分支"},
    )
    node_by_id = {switch.id: switch, sink.id: sink}

    matched = validate_edge_connection(
        WorkflowEdge(id="matched", source="switch", sourceHandle="matched", target="sink", targetHandle="input"),
        node_by_id,
        registry,
        existing_edges=[],
    )
    missing = validate_edge_connection(
        WorkflowEdge(id="missing", source="switch", sourceHandle="missing", target="sink", targetHandle="input"),
        node_by_id,
        registry,
        existing_edges=[],
    )

    assert matched.valid is True
    assert missing.code == ConnectionValidationCode.UNKNOWN_SOURCE_PORT
    assert node_definition_issues(switch, registry, "nodes.switch") == []


def test_switch_rejects_invalid_rule_port_and_pinned_output():
    registry = builtin_registry()
    invalid = switch_node(pinned_data={"stale": {}})
    invalid.config["rules"] = [{"id": "invalid-port", "label": "无效", "value": "yes"}]

    assert node_definition_issues(invalid, registry, "nodes.switch") == [
        ("nodes.switch.config.rules.0.id", "String should match pattern '^[A-Za-z_][A-Za-z0-9_]*$'"),
        ("nodes.switch.pinnedData.stale", "不存在的输出端口：stale"),
    ]


@pytest.mark.asyncio
async def test_switch_routes_only_the_matching_dynamic_output():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = builtin_registry()
    workflow = storage.save_workflow(
        WorkflowDocument(
            id="dynamic_switch",
            name="动态路由",
            nodes=[
                WorkflowNode(
                    id="start",
                    type="manual.trigger",
                    position=Position(x=0, y=0),
                    config={"payload": {}},
                ),
                WorkflowNode(
                    id="value",
                    type="utility.transform",
                    position=Position(x=200, y=0),
                    config={"value": "yes"},
                ),
                switch_node(),
                WorkflowNode(
                    id="matched_log",
                    type="utility.log",
                    position=Position(x=600, y=0),
                    config={"message": "匹配分支已执行"},
                ),
                WorkflowNode(
                    id="fallback_log",
                    type="utility.log",
                    position=Position(x=600, y=160),
                    config={"message": "未匹配分支不应执行"},
                ),
            ],
            edges=[
                WorkflowEdge(id="start_value", source="start", sourceHandle="success", target="value", targetHandle="input"),
                WorkflowEdge(id="value_switch", source="value", sourceHandle="success", target="switch", targetHandle="input"),
                WorkflowEdge(id="switch_match", source="switch", sourceHandle="matched", target="matched_log", targetHandle="input"),
                WorkflowEdge(id="switch_fallback", source="switch", sourceHandle="fallback", target="fallback_log", targetHandle="input"),
            ],
        )
    )
    run = storage.create_run(workflow)

    await WorkflowExecutor(storage=storage, registry=registry).execute(run.id, workflow)

    started_nodes = {event.node_id for event in storage.list_events(run.id) if event.type == "node_started"}
    assert storage.get_run(run.id).status == "succeeded"
    assert "matched_log" in started_nodes
    assert "fallback_log" not in started_nodes
