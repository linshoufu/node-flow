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


def log_node(node_id: str, x: float = 0, y: float = 0) -> WorkflowNode:
    return WorkflowNode(
        id=node_id,
        type="utility.log",
        position=position(x, y),
        config={"message": "ok"},
    )


async def execute_workflow(workflow: WorkflowDocument):
    storage = Storage(":memory:")
    storage.init_schema()
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=make_registry())

    await executor.execute(run.id, saved)

    return storage, run


@pytest.mark.asyncio
async def test_foreach_runs_body_for_each_item():
    workflow = WorkflowDocument(
        id="wf_foreach",
        name="For Each",
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
                    "body": WorkflowSubflow(nodes=[log_node("body_log")], edges=[]),
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

    storage, run = await execute_workflow(workflow)

    assert storage.get_run(run.id).status == "succeeded"
    body_successes = [
        event
        for event in storage.list_events(run.id)
        if event.node_id == "body_log" and event.type == "node_succeeded"
    ]
    assert len(body_successes) == 3
    assert body_successes[1].scope == ["each", "iteration:1"]


@pytest.mark.asyncio
async def test_while_stops_at_max_reached_handle():
    workflow = WorkflowDocument(
        id="wf_while",
        name="While",
        nodes=[
            WorkflowNode(
                id="start",
                type="manual.trigger",
                position=position(),
                config={"payload": {"always": True}},
            ),
            WorkflowNode(
                id="while_loop",
                type="control.while",
                position=position(200, 0),
                config={
                    "condition": "{{ inputs.input.always }}",
                    "max_iterations": 2,
                },
                subflows={
                    "body": WorkflowSubflow(nodes=[log_node("body_log")], edges=[]),
                },
            ),
            log_node("max_log", x=400, y=0),
        ],
        edges=[
            WorkflowEdge(
                id="e1",
                source="start",
                sourceHandle="success",
                target="while_loop",
                targetHandle="input",
            ),
            WorkflowEdge(
                id="e2",
                source="while_loop",
                sourceHandle="max_reached",
                target="max_log",
                targetHandle="input",
            ),
        ],
    )

    storage, run = await execute_workflow(workflow)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    assert any(event.node_id == "max_log" and event.type == "node_succeeded" for event in events)
