import asyncio
from pathlib import Path

import pytest

from apps.api.nodeflow_api.executor import WorkflowExecutor
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import (
    Position,
    WorkflowDocument,
    WorkflowEdge,
    WorkflowNode,
    WorkflowSubflow,
)
from apps.api.nodeflow_api.storage import Storage


def make_registry() -> NodeRegistry:
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    return registry


def position(x: float = 0, y: float = 0) -> Position:
    return Position(x=x, y=y)


def delay_node(node_id: str, seconds: float = 0.05, x: float = 0, y: float = 0) -> WorkflowNode:
    return WorkflowNode(
        id=node_id,
        type="utility.delay",
        position=position(x, y),
        config={"seconds": seconds},
    )


def log_node(node_id: str, x: float = 0, y: float = 0) -> WorkflowNode:
    return WorkflowNode(
        id=node_id,
        type="utility.log",
        position=position(x, y),
        config={"message": "should not run"},
    )


async def wait_for_event(storage: Storage, run_id: str, node_id: str, event_type: str) -> None:
    deadline = asyncio.get_running_loop().time() + 2
    while asyncio.get_running_loop().time() < deadline:
        if any(
            event.node_id == node_id and event.type == event_type
            for event in storage.list_events(run_id)
        ):
            return
        await asyncio.sleep(0.01)
    raise AssertionError(f"Timed out waiting for {event_type} on {node_id}")


@pytest.mark.asyncio
async def test_executor_cancels_after_active_node_and_skips_downstream_nodes():
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = WorkflowDocument(
        id="wf_cancel_chain",
        name="Cancel Chain",
        nodes=[
            delay_node("delay", seconds=0.05),
            log_node("after", x=200),
        ],
        edges=[
            WorkflowEdge(
                id="e1",
                source="delay",
                sourceHandle="success",
                target="after",
                targetHandle="input",
            )
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=make_registry())

    task = asyncio.create_task(executor.execute(run.id, saved))
    await wait_for_event(storage, run.id, "delay", "node_started")
    storage.request_run_cancel(run.id)
    await task

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "cancelled"
    assert any(event.type == "run_cancel_requested" for event in events)
    assert any(event.type == "run_cancelled" for event in events)
    assert not any(event.node_id == "after" and event.type == "node_started" for event in events)


@pytest.mark.asyncio
async def test_executor_cancels_foreach_between_iterations():
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = WorkflowDocument(
        id="wf_cancel_foreach",
        name="Cancel ForEach",
        nodes=[
            WorkflowNode(
                id="start",
                type="manual.trigger",
                position=position(),
                config={"payload": {"items": [1, 2, 3]}},
            ),
            WorkflowNode(
                id="each",
                type="control.foreach",
                position=position(200, 0),
                config={"items_expression": "{{ inputs.input.items }}"},
                subflows={
                    "body": WorkflowSubflow(nodes=[delay_node("body_delay", seconds=0.05)], edges=[]),
                },
            ),
        ],
        edges=[
            WorkflowEdge(
                id="e1",
                source="start",
                sourceHandle="success",
                target="each",
                targetHandle="input",
            )
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=make_registry())

    task = asyncio.create_task(executor.execute(run.id, saved))
    await wait_for_event(storage, run.id, "body_delay", "node_started")
    storage.request_run_cancel(run.id)
    await task

    body_starts = [
        event
        for event in storage.list_events(run.id)
        if event.node_id == "body_delay" and event.type == "node_started"
    ]
    assert storage.get_run(run.id).status == "cancelled"
    assert [event.scope for event in body_starts] == [["each", "iteration:0"]]


@pytest.mark.asyncio
async def test_executor_fails_when_workflow_timeout_is_reached():
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = WorkflowDocument(
        id="wf_timeout",
        name="Timeout",
        settings={"timeout_seconds": 0.01},
        nodes=[delay_node("delay", seconds=0.1)],
        edges=[],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=make_registry())

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    stored_run = storage.get_run(run.id)
    assert stored_run.status == "failed"
    assert stored_run.error == "Workflow timed out after 0.01 seconds"
    assert any(
        event.type == "run_failed"
        and event.payload["error"] == "Workflow timed out after 0.01 seconds"
        for event in events
    )
