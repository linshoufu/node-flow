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
    WorkflowSettings,
)
from apps.api.nodeflow_api.storage import Storage
from apps.api.nodeflow_api.workflow_static_data import WorkflowStaticDataTransaction


def state_registry(tmp_path: Path) -> NodeRegistry:
    (tmp_path / "state_nodes.py").write_text(
        dedent(
            '''
            from nodeflow_sdk import BaseNode, NodeConfig, NodeContext, Output, node


            @node(id="test.state_counter", name="State Counter", category="Test")
            class StateCounterNode(BaseNode[NodeConfig]):
                outputs = {"success": Output(description="Updated count")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    count = ctx.get_node_static_data("count", 0)
                    ctx.set_node_static_data("count", count + 1)
                    return {"success": {"count": count + 1}}


            @node(id="test.state_failure", name="State Failure", category="Test")
            class StateFailureNode(BaseNode[NodeConfig]):
                outputs = {"success": Output(description="Unreachable")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    ctx.set_workflow_static_data("should_not_persist", True)
                    raise RuntimeError("expected failure")
            '''
        ),
        encoding="utf-8",
    )
    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()
    return registry


def single_node_workflow(workflow_id: str, node_type: str) -> WorkflowDocument:
    return WorkflowDocument(
        id=workflow_id,
        name="Workflow static data",
        nodes=[
            WorkflowNode(
                id="stateful",
                type=node_type,
                position=Position(x=0, y=0),
                config={},
            )
        ],
        edges=[],
    )


@pytest.mark.asyncio
async def test_node_static_data_persists_across_successful_root_runs(tmp_path: Path):
    storage = Storage(tmp_path / "state.sqlite3")
    storage.init_schema()
    registry = state_registry(tmp_path)
    workflow = storage.save_workflow(single_node_workflow("wf_state_counter", "test.state_counter"))
    executor = WorkflowExecutor(storage=storage, registry=registry)

    first_run = storage.create_run(workflow)
    await executor.execute(first_run.id, workflow)
    second_run = storage.create_run(workflow)
    await executor.execute(second_run.id, workflow)

    second_output = next(
        event.payload["outputs"]["success"]
        for event in storage.list_events(second_run.id)
        if event.type == "node_succeeded"
    )
    assert second_output == {"count": 2}
    assert storage.get_workflow_static_data(workflow.id) == {
        "workflow": {},
        "nodes": {"stateful": {"count": 2}},
    }


@pytest.mark.asyncio
async def test_failed_root_run_discards_pending_workflow_static_data(tmp_path: Path):
    storage = Storage(tmp_path / "state-failure.sqlite3")
    storage.init_schema()
    registry = state_registry(tmp_path)
    workflow = storage.save_workflow(single_node_workflow("wf_state_failure", "test.state_failure"))
    run = storage.create_run(workflow)

    await WorkflowExecutor(storage=storage, registry=registry).execute(run.id, workflow)

    assert storage.get_run(run.id).status == "failed"
    assert storage.get_workflow_static_data(workflow.id) == {}


@pytest.mark.asyncio
async def test_parent_failure_discards_static_data_staged_by_a_child_workflow(tmp_path: Path):
    storage = Storage(tmp_path / "child-state.sqlite3")
    storage.init_schema()
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    registry._nodes.update(state_registry(tmp_path)._nodes)
    child = storage.save_workflow(
        WorkflowDocument(
            id="wf_state_child",
            name="State child",
            nodes=[
                WorkflowNode(id="trigger", type="workflow.trigger", position=Position(x=0, y=0), config={}),
                WorkflowNode(id="counter", type="test.state_counter", position=Position(x=220, y=0), config={}),
                WorkflowNode(id="return", type="workflow.return", position=Position(x=440, y=0), config={}),
            ],
            edges=[
                WorkflowEdge(id="trigger_counter", source="trigger", sourceHandle="success", target="counter", targetHandle="input"),
                WorkflowEdge(id="counter_return", source="counter", sourceHandle="success", target="return", targetHandle="input"),
            ],
        )
    )
    parent = storage.save_workflow(
        WorkflowDocument(
            id="wf_state_parent",
            name="State parent",
            nodes=[
                WorkflowNode(
                    id="call_child",
                    type="workflow.execute",
                    position=Position(x=0, y=0),
                    config={"workflow_id": child.id},
                ),
                WorkflowNode(
                    id="fail_parent",
                    type="test.state_failure",
                    position=Position(x=240, y=0),
                    config={},
                ),
            ],
            edges=[
                WorkflowEdge(
                    id="child_failure",
                    source="call_child",
                    sourceHandle="success",
                    target="fail_parent",
                    targetHandle="input",
                )
            ],
        )
    )
    parent_run = storage.create_run(parent)

    await WorkflowExecutor(storage=storage, registry=registry).execute(parent_run.id, parent)

    assert storage.get_run(parent_run.id).status == "failed"
    assert storage.get_workflow_static_data(child.id) == {}


@pytest.mark.asyncio
async def test_successful_parent_commits_static_data_staged_by_a_child_workflow(tmp_path: Path):
    storage = Storage(tmp_path / "child-state-success.sqlite3")
    storage.init_schema()
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    registry._nodes.update(state_registry(tmp_path)._nodes)
    child = storage.save_workflow(
        WorkflowDocument(
            id="wf_state_child_success",
            name="State child success",
            nodes=[
                WorkflowNode(id="trigger", type="workflow.trigger", position=Position(x=0, y=0), config={}),
                WorkflowNode(id="counter", type="test.state_counter", position=Position(x=220, y=0), config={}),
            ],
            edges=[
                WorkflowEdge(
                    id="trigger_counter",
                    source="trigger",
                    sourceHandle="success",
                    target="counter",
                    targetHandle="input",
                )
            ],
        )
    )
    parent = storage.save_workflow(
        WorkflowDocument(
            id="wf_state_parent_success",
            name="State parent success",
            nodes=[
                WorkflowNode(
                    id="call_child",
                    type="workflow.execute",
                    position=Position(x=0, y=0),
                    config={"workflow_id": child.id},
                )
            ],
            edges=[],
        )
    )
    parent_run = storage.create_run(parent)

    await WorkflowExecutor(storage=storage, registry=registry).execute(parent_run.id, parent)

    assert storage.get_run(parent_run.id).status == "succeeded"
    assert storage.get_workflow_static_data(child.id) == {
        "workflow": {},
        "nodes": {"counter": {"count": 1}},
    }
    assert any(
        event.type == "workflow_static_data_saved"
        and event.payload["workflow_ids"] == [child.id]
        for event in storage.list_events(parent_run.id)
    )


@pytest.mark.asyncio
async def test_error_workflow_commits_its_own_static_data_after_a_failed_run(tmp_path: Path):
    storage = Storage(tmp_path / "error-state.sqlite3")
    storage.init_schema()
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    registry._nodes.update(state_registry(tmp_path)._nodes)
    error_workflow = storage.save_workflow(
        WorkflowDocument(
            id="wf_state_error_handler",
            name="State error handler",
            nodes=[
                WorkflowNode(id="trigger", type="workflow.trigger", position=Position(x=0, y=0), config={}),
                WorkflowNode(id="counter", type="test.state_counter", position=Position(x=220, y=0), config={}),
            ],
            edges=[
                WorkflowEdge(
                    id="trigger_counter",
                    source="trigger",
                    sourceHandle="success",
                    target="counter",
                    targetHandle="input",
                )
            ],
        )
    )
    failing_workflow = storage.save_workflow(
        WorkflowDocument(
            id="wf_state_failing_with_handler",
            name="State failure with handler",
            settings=WorkflowSettings(error_workflow_id=error_workflow.id),
            nodes=[
                WorkflowNode(
                    id="fail",
                    type="test.state_failure",
                    position=Position(x=0, y=0),
                    config={},
                )
            ],
            edges=[],
        )
    )
    run = storage.create_run(failing_workflow)

    await WorkflowExecutor(storage=storage, registry=registry).execute(run.id, failing_workflow)

    assert storage.get_run(run.id).status == "failed"
    assert storage.get_workflow_static_data(failing_workflow.id) == {}
    assert storage.get_workflow_static_data(error_workflow.id) == {
        "workflow": {},
        "nodes": {"counter": {"count": 1}},
    }


def test_static_data_rejects_a_concurrent_overwrite(tmp_path: Path):
    storage = Storage(tmp_path / "state-conflict.sqlite3")
    storage.init_schema()
    workflow = storage.save_workflow(single_node_workflow("wf_state_conflict", "test.state_counter"))
    first = WorkflowStaticDataTransaction(storage)
    second = WorkflowStaticDataTransaction(storage)

    first.set(workflow.id, "counter", "node", "cursor", "first")
    second.set(workflow.id, "counter", "node", "cursor", "second")
    first.commit()

    with pytest.raises(RuntimeError, match="changed concurrently"):
        second.commit()

    assert storage.get_workflow_static_data(workflow.id) == {
        "workflow": {},
        "nodes": {"counter": {"cursor": "first"}},
    }
