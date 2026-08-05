from pathlib import Path

import pytest

from apps.api.nodeflow_api.executor import WorkflowExecutor
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowEdge, WorkflowNode, WorkflowSubflow
from apps.api.nodeflow_api.storage import Storage


def make_registry() -> NodeRegistry:
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    return registry


def position(x: float = 0, y: float = 0) -> Position:
    return Position(x=x, y=y)


@pytest.mark.asyncio
async def test_item_map_filter_and_merge_preserve_item_lineage(tmp_path: Path):
    csv_path = tmp_path / "cases.csv"
    csv_path.write_text("id,enabled\nfirst,yes\nsecond,no\n", encoding="utf-8")
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = WorkflowDocument(
        id="wf_item_data_nodes",
        name="Item data nodes",
        nodes=[
            WorkflowNode(
                id="csv",
                type="data.csv_read",
                position=position(),
                config={"path": str(csv_path)},
            ),
            WorkflowNode(
                id="map",
                type="data.map_items",
                position=position(200, 0),
                config={"value": {"caseId": "{{ item.id }}", "selected": "{{ item.enabled }}"}},
            ),
            WorkflowNode(
                id="filter",
                type="data.filter_items",
                position=position(400, 0),
                config={
                    "value_expression": "{{ item.selected }}",
                    "operator": "equals",
                    "expected_value": "yes",
                },
            ),
            WorkflowNode(
                id="merge",
                type="data.merge_items",
                position=position(600, 0),
                config={},
            ),
        ],
        edges=[
            WorkflowEdge(id="csv_map", source="csv", sourceHandle="items", target="map", targetHandle="items"),
            WorkflowEdge(id="map_filter", source="map", sourceHandle="items", target="filter", targetHandle="items"),
            WorkflowEdge(id="csv_merge", source="csv", sourceHandle="items", target="merge", targetHandle="items"),
            WorkflowEdge(id="filter_merge", source="filter", sourceHandle="items", target="merge", targetHandle="items"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)

    await WorkflowExecutor(storage=storage, registry=make_registry()).execute(run.id, saved)

    events = storage.list_events(run.id)
    mapped = next(event for event in events if event.node_id == "map" and event.type == "node_succeeded")
    filtered = next(event for event in events if event.node_id == "filter" and event.type == "node_succeeded")
    merged = next(event for event in events if event.node_id == "merge" and event.type == "node_succeeded")

    assert mapped.payload["outputs"]["items"] == [
        {"json": {"caseId": "first", "selected": "yes"}, "pairedItem": {"item": 0}},
        {"json": {"caseId": "second", "selected": "no"}, "pairedItem": {"item": 1}},
    ]
    assert filtered.payload["outputs"]["items"] == [
        {"json": {"caseId": "first", "selected": "yes"}, "pairedItem": {"item": 0}},
    ]
    assert merged.payload["outputs"]["items"] == [
        {"json": {"id": "first", "enabled": "yes"}, "pairedItem": {"item": 0}},
        {"json": {"id": "second", "enabled": "no"}, "pairedItem": {"item": 1}},
        {"json": {"caseId": "first", "selected": "yes"}, "pairedItem": {"item": 0}},
    ]


def test_item_data_nodes_publish_items_port_contracts():
    registry = make_registry()

    for node_id in ("data.map_items", "data.filter_items", "data.merge_items"):
        node_type = registry.get(node_id)
        assert node_type.inputs["items"]["dataMode"] == "items"
        assert node_type.outputs["items"]["schema"]["type"] == "array"

    assert registry.get("data.merge_items").inputs["items"]["maxConnections"] is None


@pytest.mark.asyncio
async def test_item_loop_node_events_include_the_current_item_lineage(tmp_path: Path):
    csv_path = tmp_path / "cases.csv"
    csv_path.write_text("id\nfirst\nsecond\n", encoding="utf-8")
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = WorkflowDocument(
        id="wf_item_lineage",
        name="Item lineage",
        nodes=[
            WorkflowNode(id="csv", type="data.csv_read", position=position(), config={"path": str(csv_path)}),
            WorkflowNode(
                id="each",
                type="control.each_item",
                position=position(200, 0),
                config={},
                subflows={
                    "body": WorkflowSubflow(
                        nodes=[
                            WorkflowNode(
                                id="transform",
                                type="utility.transform",
                                position=position(),
                                config={"value": "{{ loop.item.id }}"},
                            )
                        ],
                        edges=[],
                    )
                },
            ),
        ],
        edges=[WorkflowEdge(id="csv_each", source="csv", sourceHandle="items", target="each", targetHandle="items")],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)

    await WorkflowExecutor(storage=storage, registry=make_registry()).execute(run.id, saved)

    starts = [
        event
        for event in storage.list_events(run.id)
        if event.node_id == "transform" and event.type == "node_started"
    ]
    assert [event.payload["item_context"] for event in starts] == [
        {"index": 0, "item": {"json": {"id": "first"}, "pairedItem": {"item": 0}}},
        {"index": 1, "item": {"json": {"id": "second"}, "pairedItem": {"item": 1}}},
    ]
