import asyncio
from pathlib import Path

import pytest

from apps.api.nodeflow_api.executor import WorkflowExecutor
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.run_dispatcher import WorkflowRunDispatcher
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowNode
from apps.api.nodeflow_api.storage import Storage


def delay_workflow(*, workflow_id: str = "wf_dispatcher", max_concurrent_runs: int | None = None) -> WorkflowDocument:
    return WorkflowDocument(
        id=workflow_id,
        name="Dispatcher workflow",
        settings={"max_concurrent_runs": max_concurrent_runs},
        nodes=[
            WorkflowNode(
                id="delay",
                type="utility.delay",
                position=Position(x=0, y=0),
                config={"seconds": 0.1},
            )
        ],
        edges=[],
    )


@pytest.mark.asyncio
async def test_dispatcher_limits_background_runs_and_keeps_waiting_runs_queued(tmp_path):
    storage = Storage(tmp_path / "dispatcher.sqlite3")
    storage.init_schema()
    workflow = storage.save_workflow(delay_workflow())
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    dispatcher = WorkflowRunDispatcher(
        storage=storage,
        executor=WorkflowExecutor(storage=storage, registry=registry),
        max_concurrent_runs=1,
    )
    first_run = storage.create_run(workflow)
    second_run = storage.create_run(workflow)

    dispatcher.submit(first_run, workflow)
    dispatcher.submit(second_run, workflow)
    await asyncio.sleep(0.02)

    assert [storage.get_run(first_run.id).status, storage.get_run(second_run.id).status] == [
        "running",
        "queued",
    ]
    assert dispatcher.queue_status(first_run.id).model_dump() == {
        "run_id": first_run.id,
        "state": "running",
        "position": None,
        "active_count": 1,
        "concurrency_limit": 1,
        "workflow_active_count": None,
        "workflow_concurrency_limit": None,
    }
    assert dispatcher.queue_status(second_run.id).model_dump() == {
        "run_id": second_run.id,
        "state": "queued",
        "position": 1,
        "active_count": 1,
        "concurrency_limit": 1,
        "workflow_active_count": None,
        "workflow_concurrency_limit": None,
    }

    await dispatcher.wait_for_idle()

    assert storage.get_run(first_run.id).status == "succeeded"
    assert storage.get_run(second_run.id).status == "succeeded"


@pytest.mark.asyncio
async def test_dispatcher_limits_each_workflow_without_blocking_other_workflows(tmp_path):
    storage = Storage(tmp_path / "per_workflow_dispatcher.sqlite3")
    storage.init_schema()
    constrained_workflow = storage.save_workflow(
        delay_workflow(workflow_id="wf_constrained", max_concurrent_runs=1)
    )
    other_workflow = storage.save_workflow(delay_workflow(workflow_id="wf_other"))
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    dispatcher = WorkflowRunDispatcher(
        storage=storage,
        executor=WorkflowExecutor(storage=storage, registry=registry),
        max_concurrent_runs=2,
    )
    first_constrained_run = storage.create_run(constrained_workflow)
    second_constrained_run = storage.create_run(constrained_workflow)
    other_run = storage.create_run(other_workflow)

    dispatcher.submit(first_constrained_run, constrained_workflow)
    dispatcher.submit(second_constrained_run, constrained_workflow)
    dispatcher.submit(other_run, other_workflow)
    await asyncio.sleep(0.02)

    assert storage.get_run(first_constrained_run.id).status == "running"
    assert storage.get_run(second_constrained_run.id).status == "queued"
    assert storage.get_run(other_run.id).status == "running"

    queue_status = dispatcher.queue_status(second_constrained_run.id)
    assert queue_status is not None
    assert queue_status.workflow_active_count == 1
    assert queue_status.workflow_concurrency_limit == 1

    await dispatcher.wait_for_idle()

    assert storage.get_run(first_constrained_run.id).status == "succeeded"
    assert storage.get_run(second_constrained_run.id).status == "succeeded"

@pytest.mark.asyncio
async def test_dispatcher_cancels_a_queued_run_without_letting_it_consume_an_execution_slot(tmp_path):
    storage = Storage(tmp_path / "dispatcher-cancel.sqlite3")
    storage.init_schema()
    workflow = storage.save_workflow(delay_workflow())
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    dispatcher = WorkflowRunDispatcher(
        storage=storage,
        executor=WorkflowExecutor(storage=storage, registry=registry),
        max_concurrent_runs=1,
    )
    first_run = storage.create_run(workflow)
    queued_run = storage.create_run(workflow)

    dispatcher.submit(first_run, workflow)
    dispatcher.submit(queued_run, workflow)
    await asyncio.sleep(0.02)

    assert storage.get_run(queued_run.id).status == "queued"
    assert dispatcher.cancel(queued_run.id) is True

    cancelled_run = storage.get_run(queued_run.id)
    assert cancelled_run.status == "cancelled"
    assert cancelled_run.completed_at is not None
    assert [event.type for event in storage.list_events(queued_run.id)] == [
        "run_cancel_requested",
        "run_cancelled",
    ]

    await dispatcher.wait_for_idle()

    assert storage.get_run(queued_run.id).status == "cancelled"
    assert not any(event.type == "node_started" for event in storage.list_events(queued_run.id))

