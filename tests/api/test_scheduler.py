from __future__ import annotations

import pytest
from pathlib import Path

from apps.api.nodeflow_api.executor import WorkflowExecutor
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowEdge, WorkflowNode
from apps.api.nodeflow_api.scheduler import WorkflowScheduler
from apps.api.nodeflow_api.storage import Storage


def schedule_workflow(*, active: bool = True, disabled: bool = False) -> WorkflowDocument:
    return WorkflowDocument(
        id="wf_schedule",
        name="Scheduled workflow",
        active=active,
        nodes=[
            WorkflowNode(
                id="schedule",
                type="schedule.trigger",
                position=Position(x=0, y=0),
                config={"interval_seconds": 30},
                disabled=disabled,
            ),
            WorkflowNode(
                id="log",
                type="utility.log",
                position=Position(x=240, y=0),
                config={"message": "scheduled"},
            ),
        ],
        edges=[
            WorkflowEdge(
                id="schedule_log",
                source="schedule",
                sourceHandle="success",
                target="log",
                targetHandle="input",
            )
        ],
    )


def make_scheduler(tmp_path, clock):
    storage = Storage(tmp_path / "scheduler.sqlite3")
    storage.init_schema()
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    executor = WorkflowExecutor(storage=storage, registry=registry)
    return storage, WorkflowScheduler(storage=storage, executor=executor, registry=registry, clock=lambda: clock["value"])


@pytest.mark.asyncio
async def test_scheduler_waits_for_interval_then_runs_the_matching_schedule_trigger(tmp_path):
    clock = {"value": 1_000.0}
    storage, scheduler = make_scheduler(tmp_path, clock)
    storage.save_workflow(schedule_workflow())

    assert await scheduler.tick() == []

    clock["value"] += 29
    assert await scheduler.tick() == []

    clock["value"] += 1
    runs = await scheduler.tick()

    assert len(runs) == 1
    await scheduler.wait_for_idle()
    assert storage.get_run(runs[0].id).status == "succeeded"
    events = storage.list_events(runs[0].id)
    assert [event.node_id for event in events if event.type == "node_started"] == ["schedule", "log"]
    schedule_event = next(event for event in events if event.node_id == "schedule" and event.type == "node_succeeded")
    assert schedule_event.payload["outputs"]["success"]["trigger"] == "schedule"


@pytest.mark.asyncio
async def test_scheduler_skips_inactive_workflows_and_does_not_relaunch_before_the_next_interval(tmp_path):
    clock = {"value": 2_000.0}
    storage, scheduler = make_scheduler(tmp_path, clock)
    storage.save_workflow(schedule_workflow(active=False))

    clock["value"] += 90
    assert await scheduler.tick() == []

    storage.save_workflow(schedule_workflow(active=True))
    assert await scheduler.tick() == []

    clock["value"] += 30
    first_runs = await scheduler.tick()
    assert len(first_runs) == 1
    assert await scheduler.tick() == []
    await scheduler.wait_for_idle()

    clock["value"] += 30
    second_runs = await scheduler.tick()
    assert len(second_runs) == 1
    await scheduler.wait_for_idle()


@pytest.mark.asyncio
async def test_scheduler_enqueues_each_due_interval_when_the_previous_run_is_still_open(tmp_path):
    clock = {"value": 2_250.0}
    storage, scheduler = make_scheduler(tmp_path, clock)
    storage.save_workflow(schedule_workflow())

    assert await scheduler.tick() == []

    clock["value"] += 30
    first_runs = await scheduler.tick()
    assert len(first_runs) == 1
    assert storage.get_run(first_runs[0].id).status == "queued"

    clock["value"] += 30
    second_runs = await scheduler.tick()

    assert len(second_runs) == 1
    assert second_runs[0].id != first_runs[0].id
    assert storage.get_run(second_runs[0].id).status == "queued"
    await scheduler.wait_for_idle()


@pytest.mark.asyncio
async def test_scheduler_skips_disabled_schedule_triggers_and_reports_them_as_inactive(tmp_path):
    clock = {"value": 2_500.0}
    storage, scheduler = make_scheduler(tmp_path, clock)
    saved = storage.save_workflow(schedule_workflow(disabled=True))

    clock["value"] += 90
    assert await scheduler.tick() == []

    status = scheduler.trigger_statuses(saved)[0]
    assert status.active is False
    assert status.next_run_at is None


@pytest.mark.asyncio
async def test_scheduler_exposes_generic_trigger_status_and_the_next_schedule_time(tmp_path):
    clock = {"value": 3_000.0}
    storage, scheduler = make_scheduler(tmp_path, clock)
    saved = storage.save_workflow(schedule_workflow())

    before_first_tick = [status.model_dump() for status in scheduler.trigger_statuses(saved)]
    assert before_first_tick == [
        {
            "node_id": "schedule",
            "type": "schedule.trigger",
            "active": True,
            "interval_seconds": 30,
            "next_run_at": None,
            "details": {},
        }
    ]

    await scheduler.tick()

    status = scheduler.trigger_statuses(saved)[0]
    assert status.next_run_at == "1970-01-01T00:50:30+00:00"


def test_scheduler_reports_generic_triggers_inactive_when_the_workflow_is_inactive(tmp_path):
    clock = {"value": 3_500.0}
    storage, scheduler = make_scheduler(tmp_path, clock)
    workflow = WorkflowDocument(
        id="wf_inactive_generic_trigger",
        name="Inactive generic trigger",
        active=False,
        nodes=[
            WorkflowNode(
                id="manual",
                type="manual.trigger",
                position=Position(x=0, y=0),
                config={},
            )
        ],
    )
    saved = storage.save_workflow(workflow)

    statuses = scheduler.trigger_statuses(saved)

    assert [(status.node_id, status.active) for status in statuses] == [("manual", False)]


@pytest.mark.asyncio
async def test_scheduler_recovers_a_persisted_next_run_time_after_restart(tmp_path):
    clock = {"value": 4_000.0}
    storage, scheduler = make_scheduler(tmp_path, clock)
    saved = storage.save_workflow(schedule_workflow())

    await scheduler.tick()

    recovered_scheduler = WorkflowScheduler(
        storage=storage,
        executor=scheduler.executor,
        registry=scheduler.registry,
        clock=lambda: clock["value"],
    )
    clock["value"] += 10
    assert await recovered_scheduler.tick() == []
    assert recovered_scheduler.trigger_statuses(saved)[0].next_run_at == "1970-01-01T01:07:10+00:00"

    clock["value"] += 20
    runs = await recovered_scheduler.tick()
    assert len(runs) == 1
    await recovered_scheduler.wait_for_idle()
