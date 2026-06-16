from pathlib import Path

from textwrap import dedent

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


def make_registry_with_failing_node(tmp_path: Path) -> NodeRegistry:
    failing_node_file = tmp_path / "failing_node.py"
    failing_node_file.write_text(
        dedent(
            """
            from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node


            @node(id="test.fail", name="Fail", category="Test", description="Always fail.")
            class FailNode(BaseNode[NodeConfig]):
                inputs = {"input": Input(required=False)}
                outputs = {"success": Output(description="Unreachable")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    raise RuntimeError("boom")
            """
        ),
        encoding="utf-8",
    )
    registry = make_registry()
    registry._load_file(failing_node_file)
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


async def execute_workflow(workflow: WorkflowDocument, registry: NodeRegistry | None = None):
    storage = Storage(":memory:")
    storage.init_schema()
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry or make_registry())

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


@pytest.mark.asyncio
async def test_foreach_routes_error_output_when_body_fails(tmp_path):
    workflow = WorkflowDocument(
        id="wf_foreach_error",
        name="For Each Error",
        nodes=[
            WorkflowNode(
                id="start",
                type="manual.trigger",
                position=position(),
                config={"payload": {"items": [1]}},
            ),
            WorkflowNode(
                id="each",
                type="control.foreach",
                position=position(200, 0),
                config={"items_expression": "{{ inputs.input.items }}"},
                subflows={
                    "body": WorkflowSubflow(
                        nodes=[
                            WorkflowNode(
                                id="body_fail",
                                type="test.fail",
                                position=position(),
                            )
                        ],
                        edges=[],
                    ),
                },
            ),
            log_node("error_log", x=400, y=0),
        ],
        edges=[
            WorkflowEdge(
                id="e1",
                source="start",
                sourceHandle="success",
                target="each",
                targetHandle="input",
            ),
            WorkflowEdge(
                id="e2",
                source="each",
                sourceHandle="error",
                target="error_log",
                targetHandle="input",
            ),
        ],
    )

    storage, run = await execute_workflow(
        workflow,
        registry=make_registry_with_failing_node(tmp_path),
    )

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    foreach_success = next(
        event for event in events if event.node_id == "each" and event.type == "node_succeeded"
    )
    assert "error" in foreach_success.payload["outputs"]
    assert any(event.node_id == "error_log" and event.type == "node_succeeded" for event in events)


@pytest.mark.asyncio
async def test_while_without_max_reached_edge_fails():
    workflow = WorkflowDocument(
        id="wf_while_unhandled_max",
        name="While Unhandled Max",
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
                    "max_iterations": 1,
                },
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
                target="while_loop",
                targetHandle="input",
            )
        ],
    )

    storage, run = await execute_workflow(workflow)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "failed"
    run_failed = next(event for event in events if event.type == "run_failed")
    assert "max_reached" in run_failed.payload["error"]


@pytest.mark.asyncio
async def test_nested_while_preserves_outer_loop_context():
    workflow = WorkflowDocument(
        id="wf_nested_while",
        name="Nested While",
        nodes=[
            WorkflowNode(
                id="start",
                type="manual.trigger",
                position=position(),
                config={"payload": {"items": [{"always": True}, {"always": True}]}},
            ),
            WorkflowNode(
                id="each",
                type="control.foreach",
                position=position(200, 0),
                config={"items_expression": "{{ inputs.input.items }}"},
                subflows={
                    "body": WorkflowSubflow(
                        nodes=[
                            WorkflowNode(
                                id="inner_while",
                                type="control.while",
                                position=position(),
                                config={
                                    "condition": "{{ loop.item.always }}",
                                    "max_iterations": 2,
                                },
                                subflows={
                                    "body": WorkflowSubflow(
                                        nodes=[log_node("while_body_log")],
                                        edges=[],
                                    ),
                                },
                            ),
                            log_node("inner_max_log", x=200, y=0),
                        ],
                        edges=[
                            WorkflowEdge(
                                id="inner_e1",
                                source="inner_while",
                                sourceHandle="max_reached",
                                target="inner_max_log",
                                targetHandle="input",
                            )
                        ],
                    ),
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

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    assert sum(
        event.node_id == "while_body_log" and event.type == "node_succeeded"
        for event in events
    ) == 4
    assert sum(
        event.node_id == "inner_max_log" and event.type == "node_succeeded"
        for event in events
    ) == 2
