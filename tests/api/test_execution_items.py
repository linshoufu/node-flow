from apps.api.nodeflow_api.execution_items import normalize_execution_items, normalize_port_execution_items
from apps.api.nodeflow_api.executor import WorkflowExecutor
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowEdge, WorkflowNode
from apps.api.nodeflow_api.storage import Storage
from pathlib import Path
from textwrap import dedent
import pytest


def test_normalize_execution_items_wraps_raw_values_and_preserves_item_metadata():
    assert normalize_execution_items({"id": 1}) == [{"json": {"id": 1}}]
    assert normalize_execution_items(
        [
            {"json": {"id": 1}, "pairedItem": {"item": 0}},
            {"id": 2},
        ]
    ) == [
        {"json": {"id": 1}, "pairedItem": {"item": 0}},
        {"json": {"id": 2}},
    ]


def test_normalize_port_execution_items_keeps_the_port_boundary():
    assert normalize_port_execution_items(
        {"body": {"id": 1}, "headers": [{"json": {"x-request-id": "abc"}}]}
    ) == {
        "body": [{"json": {"id": 1}}],
        "headers": [{"json": {"x-request-id": "abc"}}],
    }


@pytest.mark.asyncio
async def test_executor_persists_authoritative_input_and_output_items_for_each_port():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    item = {"json": {"id": 1}, "pairedItem": {"item": 0}}
    workflow = WorkflowDocument(
        id="wf_execution_items",
        name="Execution items",
        nodes=[
            WorkflowNode(
                id="start",
                type="manual.trigger",
                position=Position(x=0, y=0),
                config={"payload": item},
            ),
            WorkflowNode(
                id="log",
                type="utility.log",
                position=Position(x=240, y=0),
                config={"message": "received"},
            ),
        ],
        edges=[
            WorkflowEdge(
                id="start-to-log",
                source="start",
                sourceHandle="success",
                target="log",
                targetHandle="input",
            )
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)

    await WorkflowExecutor(storage=storage, registry=registry).execute(run.id, saved)

    events = storage.list_events(run.id)
    start_succeeded = next(event for event in events if event.node_id == "start" and event.type == "node_succeeded")
    log_started = next(event for event in events if event.node_id == "log" and event.type == "node_started")
    assert start_succeeded.payload["output_items"] == {"success": [item]}
    assert log_started.payload["input_items"] == {"input": [item]}


@pytest.mark.asyncio
async def test_executor_normalizes_values_for_an_item_aware_input_port(tmp_path: Path):
    (tmp_path / "item_consumer.py").write_text(
        dedent(
            """
            from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node


            @node(id="test.item_source", name="Item source", category="Test")
            class ItemSource(BaseNode[NodeConfig]):
                outputs = {"success": Output()}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": {"id": 1}}


            @node(id="test.item_consumer", name="Item consumer", category="Test")
            class ItemConsumer(BaseNode[NodeConfig]):
                inputs = {"items": Input(data_mode="items")}
                outputs = {"success": Output()}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": {"count": len(inputs["items"]), "first": inputs["items"][0]}}
            """
        ),
        encoding="utf-8",
    )
    storage = Storage(":memory:")
    storage.init_schema()
    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()
    workflow = WorkflowDocument(
        id="wf_item_aware_input",
        name="Item aware input",
        nodes=[
            WorkflowNode(id="source", type="test.item_source", position=Position(x=0, y=0), config={}),
            WorkflowNode(id="consumer", type="test.item_consumer", position=Position(x=240, y=0), config={}),
        ],
        edges=[WorkflowEdge(id="source-to-consumer", source="source", sourceHandle="success", target="consumer", targetHandle="items")],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)

    await WorkflowExecutor(storage=storage, registry=registry).execute(run.id, saved)

    consumer_event = next(event for event in storage.list_events(run.id) if event.node_id == "consumer" and event.type == "node_succeeded")
    assert consumer_event.payload["outputs"]["success"] == {
        "count": 1,
        "first": {"json": {"id": 1}},
    }
