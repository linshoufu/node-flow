"""storage.py 拆分前的契约测试：队列认领、租约、队列状态、运行环境保护。"""

import pytest

from apps.api.nodeflow_api.schemas import (
    Position,
    RunInvocation,
    WorkflowDocument,
    WorkflowNode,
    WorkflowSettings,
)
from apps.api.nodeflow_api.storage import Storage


def queue_workflow(*, workflow_id: str = "wf_queue", max_concurrent_runs: int | None = None) -> WorkflowDocument:
    return WorkflowDocument(
        id=workflow_id,
        name="Queue workflow",
        settings={"max_concurrent_runs": max_concurrent_runs},
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


@pytest.fixture()
def storage():
    store = Storage(":memory:")
    store.init_schema()
    yield store
    store.close()


def mark_running(storage: Storage, run_id: str, *, worker_id: str = "worker_other") -> None:
    storage._connection.execute(
        "UPDATE runs SET status = 'running', worker_id = ?, started_at = '2026-01-01T00:00:00+00:00' WHERE id = ?",
        (worker_id, run_id),
    )
    storage._connection.commit()


def test_claim_next_queued_run_rejects_invalid_arguments(storage):
    workflow = storage.save_workflow(queue_workflow())
    storage.create_run(workflow)
    with pytest.raises(ValueError):
        storage.claim_next_queued_run("worker", lease_seconds=0)
    with pytest.raises(ValueError):
        storage.claim_next_queued_run("worker", lease_seconds=60, concurrency_limit=0)


def test_claim_next_queued_run_respects_global_concurrency_limit(storage):
    workflow = storage.save_workflow(queue_workflow())
    busy = storage.create_run(workflow)
    pending = storage.create_run(workflow)
    mark_running(storage, busy.id)

    assert storage.claim_next_queued_run("worker", lease_seconds=60, concurrency_limit=1) is None
    claimed = storage.claim_next_queued_run("worker", lease_seconds=60, concurrency_limit=2)
    assert claimed is not None and claimed.id == pending.id


def test_claim_next_queued_run_respects_workflow_concurrency_limit(storage):
    workflow = storage.save_workflow(queue_workflow(max_concurrent_runs=1))
    busy = storage.create_run(workflow)
    pending = storage.create_run(workflow)
    mark_running(storage, busy.id)

    assert storage.claim_next_queued_run("worker", lease_seconds=60) is None
    assert storage.get_run(pending.id).status == "queued"


def test_claim_next_queued_run_skips_runs_of_missing_workflow_versions(storage):
    workflow = storage.save_workflow(queue_workflow())
    orphan = storage.create_run(workflow)
    healthy_workflow = storage.save_workflow(queue_workflow(workflow_id="wf_queue_ok"))
    healthy = storage.create_run(healthy_workflow)
    storage._connection.execute("PRAGMA foreign_keys = OFF")
    storage._connection.execute(
        "DELETE FROM workflow_versions WHERE workflow_id = ?", (workflow.id,)
    )
    storage._connection.execute("PRAGMA foreign_keys = ON")
    storage._connection.commit()

    claimed = storage.claim_next_queued_run("worker", lease_seconds=60)
    assert claimed is not None and claimed.id == healthy.id
    assert storage.get_run(orphan.id).status == "queued"


def test_renew_run_lease_requires_matching_worker(storage):
    workflow = storage.save_workflow(queue_workflow())
    run = storage.create_run(workflow)
    claimed = storage.claim_next_queued_run("worker_a", lease_seconds=60)
    assert claimed is not None
    with pytest.raises(ValueError):
        storage.renew_run_lease(run.id, "worker_a", lease_seconds=0)
    assert storage.renew_run_lease(run.id, "worker_b", lease_seconds=60) is False
    renewed = storage.renew_run_lease(run.id, "worker_a", lease_seconds=60)
    assert renewed is True


def test_release_run_claim_returns_the_run_to_the_queue(storage):
    workflow = storage.save_workflow(queue_workflow())
    run = storage.create_run(workflow)
    assert storage.claim_next_queued_run("worker_a", lease_seconds=60) is not None

    storage.release_run_claim(run.id, "worker_a")

    record = storage.get_run(run.id)
    assert record.status == "running"
    row = storage._connection.execute(
        "SELECT worker_id, claimed_at, lease_expires_at FROM runs WHERE id = ?", (run.id,)
    ).fetchone()
    assert row["worker_id"] is None and row["claimed_at"] is None and row["lease_expires_at"] is None
    # The released run is recovered via recovery services, not re-claimed directly.
    assert storage.claim_next_queued_run("worker_b", lease_seconds=60) is None


def test_get_persistent_queue_status_validates_arguments_and_modes(storage):
    with pytest.raises(ValueError):
        storage.get_persistent_queue_status("run_missing", concurrency_limit=0)
    assert storage.get_persistent_queue_status("run_missing", concurrency_limit=4) is None

    workflow = storage.save_workflow(queue_workflow())
    webhook_run = storage.create_run(
        workflow,
        invocation=RunInvocation(execution_mode="webhook", allow_pinned_data=False),
    )
    assert storage.get_persistent_queue_status(webhook_run.id, concurrency_limit=4) is None

    finished = storage.create_run(workflow)
    storage._connection.execute(
        "UPDATE runs SET status = 'succeeded', completed_at = '2026-01-01T00:00:00+00:00' WHERE id = ?",
        (finished.id,),
    )
    storage._connection.commit()
    assert storage.get_persistent_queue_status(finished.id, concurrency_limit=4) is None


def test_get_persistent_queue_status_reports_queued_position_and_running_state(storage):
    workflow = storage.save_workflow(queue_workflow(max_concurrent_runs=2))
    first = storage.create_run(workflow)
    second = storage.create_run(workflow)
    third = storage.create_run(workflow)
    mark_running(storage, first.id)

    queued_status = storage.get_persistent_queue_status(second.id, concurrency_limit=4)
    assert queued_status is not None
    assert queued_status.state == "queued"
    assert queued_status.position == 1
    assert queued_status.active_count == 1
    assert queued_status.workflow_active_count == 1
    assert queued_status.workflow_concurrency_limit == 2

    claimed = storage.claim_next_queued_run("worker_a", lease_seconds=60)
    assert claimed is not None and claimed.id == second.id
    running_status = storage.get_persistent_queue_status(second.id, concurrency_limit=4)
    assert running_status is not None
    assert running_status.state == "running"
    assert running_status.position is None
    assert running_status.active_count == 2

    assert storage.get_persistent_queue_status(third.id, concurrency_limit=4).position == 1


def test_has_open_run_for_workflow_tracks_queued_and_running_only(storage):
    workflow = storage.save_workflow(queue_workflow())
    assert storage.has_open_run_for_workflow(workflow.id) is False
    run = storage.create_run(workflow)
    assert storage.has_open_run_for_workflow(workflow.id) is True
    storage._connection.execute(
        "UPDATE runs SET status = 'succeeded', completed_at = '2026-01-01T00:00:00+00:00' WHERE id = ?",
        (run.id,),
    )
    storage._connection.commit()
    assert storage.has_open_run_for_workflow(workflow.id) is False


def test_delete_project_environment_protects_default_and_referenced_environments(storage):
    with pytest.raises(ValueError):
        storage.delete_project_environment("default")

    environment = storage.create_project_environment(name="预发", variables={"stage": "pre"})
    workflow = storage.save_workflow(
        queue_workflow().model_copy(
            update={"settings": WorkflowSettings(environment_id=environment.id)},
        )
    )
    with pytest.raises(ValueError):
        storage.delete_project_environment(environment.id)
    assert storage.environment_is_referenced(environment.id) is True

    storage.delete_workflow(workflow.id)
    assert storage.delete_project_environment(environment.id) is True
    assert storage.delete_project_environment(environment.id) is False
    assert storage.environment_is_referenced(environment.id) is False


def test_update_project_environment_guards(storage):
    assert storage.update_project_environment("missing", name="x") is None
    default = storage.get_project_environment("default")
    assert default is not None and default.is_default is True
    with pytest.raises(ValueError):
        storage.update_project_environment("default", variables={"a": 1})
