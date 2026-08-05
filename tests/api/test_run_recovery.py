from pathlib import Path

import pytest

from apps.api.nodeflow_api.executor import WorkflowExecutor
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.run_dispatcher import WorkflowRunDispatcher
from apps.api.nodeflow_api.run_recovery import RunRecoveryService
from apps.api.nodeflow_api.schemas import Position, RunInvocation, WorkflowDocument, WorkflowNode
from apps.api.nodeflow_api.storage import Storage


def recovery_workflow() -> WorkflowDocument:
    return WorkflowDocument(
        id="wf_recovery",
        name="Recovery workflow",
        nodes=[
            WorkflowNode(
                id="start",
                type="manual.trigger",
                position=Position(x=0, y=0),
                config={},
            )
        ],
        edges=[],
    )


def make_recovery_service(tmp_path):
    storage = Storage(tmp_path / "run-recovery.sqlite3")
    storage.init_schema()
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    executor = WorkflowExecutor(storage=storage, registry=registry)
    dispatcher = WorkflowRunDispatcher(storage=storage, executor=executor)
    return storage, RunRecoveryService(storage=storage, dispatcher=dispatcher)


def test_run_invocation_round_trips_with_the_queued_run(tmp_path):
    storage, _ = make_recovery_service(tmp_path)
    workflow = storage.save_workflow(recovery_workflow())
    invocation = RunInvocation(
        entry_node_id="start",
        initial_input={"trigger": "schedule", "scheduled_at": "2026-07-20T00:00:00+00:00"},
        execution_mode="schedule",
        allow_pinned_data=False,
    )

    run = storage.create_run(workflow, invocation=invocation)

    assert storage.get_run_invocation(run.id) == invocation


@pytest.mark.asyncio
async def test_recovery_resumes_only_safe_queued_runs_and_marks_interrupted_work_explicitly(tmp_path):
    storage, recovery = make_recovery_service(tmp_path)
    workflow = storage.save_workflow(recovery_workflow())
    resumable_run = storage.create_run(workflow)
    webhook_run = storage.create_run(
        workflow,
        invocation=RunInvocation(execution_mode="webhook", allow_pinned_data=False),
    )
    interrupted_run = storage.create_run(workflow)
    storage.update_run(interrupted_run.id, status="running")

    resumed = await recovery.recover()
    await recovery.wait_for_idle()

    assert [run.id for run in resumed] == [resumable_run.id]
    assert storage.get_run(resumable_run.id).status == "succeeded"
    assert storage.get_run(webhook_run.id).status == "failed"
    assert storage.get_run(interrupted_run.id).status == "failed"
    assert [event.type for event in storage.list_events(resumable_run.id)] == [
        "run_recovered",
        "node_started",
        "node_succeeded",
        "run_succeeded",
    ]
    assert [event.type for event in storage.list_events(webhook_run.id)] == [
        "run_recovery_skipped",
    ]
    assert [event.type for event in storage.list_events(interrupted_run.id)] == [
        "run_interrupted",
    ]
