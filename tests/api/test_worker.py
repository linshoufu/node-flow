from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import asyncio
import json

import pytest

from apps.api.nodeflow_api.executor import WorkflowExecutor
from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, RunInvocation, WorkflowDocument, WorkflowNode
from apps.api.nodeflow_api.storage import Storage
from apps.api.nodeflow_api.worker import WorkflowWorker


def worker_workflow() -> WorkflowDocument:
    return WorkflowDocument(
        id="wf_worker",
        name="Worker workflow",
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


def worker_delay_workflow(*, max_concurrent_runs: int | None = None) -> WorkflowDocument:
    return WorkflowDocument(
        id="wf_worker_delay",
        name="Worker delay workflow",
        settings={"max_concurrent_runs": max_concurrent_runs},
        nodes=[
            WorkflowNode(
                id="delay",
                type="utility.delay",
                position=Position(x=0, y=0),
                config={"seconds": 0.2},
            )
        ],
        edges=[],
    )


def worker_reload_workflow() -> WorkflowDocument:
    return WorkflowDocument(
        id="wf_worker_reload",
        name="Worker reload workflow",
        nodes=[
            WorkflowNode(
                id="reloaded",
                type="test.worker_reload",
                position=Position(x=0, y=0),
                config={},
            )
        ],
        edges=[],
    )


def write_worker_node_file(path: Path) -> None:
    path.write_text(
        """
from nodeflow_sdk import BaseNode, NodeConfig, NodeContext, Output, node


@node(id="test.worker_reload", name="Worker reload", category="Test")
class WorkerReloadNode(BaseNode[NodeConfig]):
    outputs = {"success": Output(description="Done")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": {"refreshed": True}}
""".lstrip(),
        encoding="utf-8",
    )


def write_worker_node_package(package_dir: Path) -> None:
    package_dir.mkdir(parents=True)
    (package_dir / "nodeflow-package.json").write_text(
        json.dumps(
            {
                "id": "test.worker-package",
                "name": "Worker package",
                "version": "1.0.0",
                "engines": {
                    "nodeflow": ">=0.1.0,<0.2.0",
                    "python": ">=3.11",
                },
                "pythonDependencies": [],
                "nodeEntrypoints": ["worker_reload.py"],
            }
        ),
        encoding="utf-8",
    )
    write_worker_node_file(package_dir / "worker_reload.py")


@pytest.mark.asyncio
async def test_worker_claims_and_executes_only_background_eligible_runs(tmp_path):
    storage = Storage(tmp_path / "worker.sqlite3")
    storage.init_schema()
    workflow = storage.save_workflow(worker_workflow())
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    worker = WorkflowWorker(
        storage=storage,
        executor=WorkflowExecutor(storage=storage, registry=registry),
        worker_id="worker_test",
        max_concurrent_runs=1,
    )
    manual_run = storage.create_run(workflow)
    webhook_run = storage.create_run(
        workflow,
        invocation=RunInvocation(execution_mode="webhook", allow_pinned_data=False),
    )

    claimed = await worker.tick()
    await worker.wait_for_idle()

    assert [run.id for run in claimed] == [manual_run.id]
    assert storage.get_run(manual_run.id).status == "succeeded"
    assert storage.get_run(webhook_run.id).status == "queued"
    assert [event.type for event in storage.list_events(manual_run.id)] == [
        "run_claimed",
        "node_started",
        "node_succeeded",
        "run_succeeded",
    ]


@pytest.mark.asyncio
async def test_worker_refreshes_node_registry_before_claiming_a_queued_run(tmp_path):
    storage = Storage(tmp_path / "worker-reload.sqlite3")
    storage.init_schema()
    nodes_dir = tmp_path / "nodes"
    nodes_dir.mkdir()
    registry = NodeRegistry(nodes_dir=nodes_dir)
    registry.scan()
    workflow = storage.save_workflow(worker_reload_workflow())
    run = storage.create_run(workflow)
    write_worker_node_file(nodes_dir / "worker_reload.py")
    worker = WorkflowWorker(
        storage=storage,
        executor=WorkflowExecutor(storage=storage, registry=registry),
        worker_id="worker_reload",
    )

    assert [claimed.id for claimed in await worker.tick()] == [run.id]
    await worker.wait_for_idle()

    assert registry.has("test.worker_reload") is True
    assert storage.get_run(run.id).status == "succeeded"


@pytest.mark.asyncio
async def test_worker_refreshes_node_package_policy_before_claiming(tmp_path):
    storage = Storage(tmp_path / "worker-package-policy.sqlite3")
    storage.init_schema()
    nodes_dir = tmp_path / "nodes"
    write_worker_node_package(nodes_dir / "worker-package")
    registry = NodeRegistry(
        nodes_dir=nodes_dir,
        package_policy_provider=storage.node_package_policies,
    )
    registry.scan()
    worker = WorkflowWorker(
        storage=storage,
        executor=WorkflowExecutor(storage=storage, registry=registry),
        worker_id="worker_package_policy",
    )

    assert registry.has("test.worker_reload") is True
    storage.set_node_package_policy(
        "test.worker-package",
        enabled=False,
        locked_version=None,
    )

    assert await worker.tick() == []
    assert registry.has("test.worker_reload") is False
    assert registry.scan_result.packages[0].status == "disabled"


def test_worker_mode_api_restart_keeps_an_independent_worker_run_active(tmp_path):
    database_path = tmp_path / "worker-restart.sqlite3"
    storage = Storage(database_path)
    storage.init_schema()
    workflow = storage.save_workflow(worker_workflow())
    run = storage.create_run(workflow)
    claimed = storage.claim_next_queued_run("worker_external", lease_seconds=60)
    assert claimed is not None
    storage.close()

    from fastapi.testclient import TestClient

    with TestClient(
        create_app(
            database_path=database_path,
            nodes_dir=Path("nodes"),
            execution_mode="worker",
        )
    ) as client:
        assert client.get(f"/api/runs/{run.id}").json()["status"] == "running"


def test_worker_mode_api_restart_does_not_emit_recovery_events_for_queued_work(tmp_path):
    database_path = tmp_path / "worker-queued-restart.sqlite3"
    storage = Storage(database_path)
    storage.init_schema()
    workflow = storage.save_workflow(worker_workflow())
    run = storage.create_run(workflow)
    storage.close()

    from fastapi.testclient import TestClient

    with TestClient(
        create_app(
            database_path=database_path,
            nodes_dir=Path("nodes"),
            execution_mode="worker",
        )
    ) as client:
        assert client.get(f"/api/runs/{run.id}").json()["status"] == "queued"
        assert client.get(f"/api/runs/{run.id}/events").json() == []


@pytest.mark.asyncio
async def test_worker_marks_an_expired_claim_as_failed_without_replaying_it(tmp_path):
    storage = Storage(tmp_path / "worker-expired.sqlite3")
    storage.init_schema()
    workflow = storage.save_workflow(worker_workflow())
    run = storage.create_run(workflow)
    assert storage.claim_next_queued_run("worker_lost", lease_seconds=0.01) is not None
    await asyncio.sleep(0.02)
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    worker = WorkflowWorker(
        storage=storage,
        executor=WorkflowExecutor(storage=storage, registry=registry),
        worker_id="worker_replacement",
    )

    assert await worker.tick() == []

    assert storage.get_run(run.id).status == "failed"
    assert [event.type for event in storage.list_events(run.id)] == ["run_worker_lost"]


@pytest.mark.asyncio
async def test_stopped_worker_keeps_active_run_lease_for_a_replacement_to_reconcile(tmp_path):
    storage = Storage(tmp_path / "worker-stop.sqlite3")
    storage.init_schema()
    workflow = storage.save_workflow(worker_delay_workflow())
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    run = storage.create_run(workflow)
    stopping_worker = WorkflowWorker(
        storage=storage,
        executor=WorkflowExecutor(storage=storage, registry=registry),
        worker_id="worker_stopping",
        lease_seconds=0.03,
    )
    assert [claimed.id for claimed in await stopping_worker.tick()] == [run.id]
    await asyncio.sleep(0.01)
    await stopping_worker.stop()
    await asyncio.sleep(0.03)
    replacement_worker = WorkflowWorker(
        storage=storage,
        executor=WorkflowExecutor(storage=storage, registry=registry),
        worker_id="worker_replacement",
    )

    assert await replacement_worker.tick() == []
    assert storage.get_run(run.id).status == "failed"
    assert any(event.type == "run_worker_lost" for event in storage.list_events(run.id))

@pytest.mark.asyncio
async def test_worker_honors_a_workflow_concurrency_limit_across_queued_runs(tmp_path):
    storage = Storage(tmp_path / "worker-workflow-concurrency.sqlite3")
    storage.init_schema()
    workflow = storage.save_workflow(worker_delay_workflow(max_concurrent_runs=1))
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    worker = WorkflowWorker(
        storage=storage,
        executor=WorkflowExecutor(storage=storage, registry=registry),
        worker_id="worker_concurrency",
        max_concurrent_runs=2,
    )
    first_run = storage.create_run(workflow)
    second_run = storage.create_run(workflow)

    first_claimed = await worker.tick()

    assert [run.id for run in first_claimed] == [first_run.id]
    assert storage.get_run(second_run.id).status == "queued"

    await worker.wait_for_idle()
    second_claimed = await worker.tick()
    await worker.wait_for_idle()

    assert [run.id for run in second_claimed] == [second_run.id]
    assert storage.get_run(second_run.id).status == "succeeded"

def test_independent_workers_do_not_claim_past_a_workflow_concurrency_limit(tmp_path):
    database_path = tmp_path / "shared-worker-concurrency.sqlite3"
    primary_storage = Storage(database_path)
    primary_storage.init_schema()
    workflow = primary_storage.save_workflow(worker_delay_workflow(max_concurrent_runs=1))
    secondary_storage = Storage(database_path)
    primary_storage.create_run(workflow)
    secondary_storage.create_run(workflow)

    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(
            pool.map(
                lambda item: item[0].claim_next_queued_run(item[1], lease_seconds=60),
                [(primary_storage, "worker_primary"), (secondary_storage, "worker_secondary")],
            )
        )

    assert sum(claim is not None for claim in claims) == 1
    assert primary_storage._connection.execute(
        "SELECT COUNT(*) FROM runs WHERE status = 'running'"
    ).fetchone()[0] == 1
    secondary_storage.close()
    primary_storage.close()

def test_independent_workers_do_not_exceed_the_shared_global_concurrency_limit(tmp_path):
    database_path = tmp_path / "shared-global-concurrency.sqlite3"
    primary_storage = Storage(database_path)
    primary_storage.init_schema()
    workflow = primary_storage.save_workflow(worker_delay_workflow())
    secondary_storage = Storage(database_path)
    primary_storage.create_run(workflow)
    secondary_storage.create_run(workflow)

    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(
            pool.map(
                lambda item: item[0].claim_next_queued_run(
                    item[1],
                    lease_seconds=60,
                    concurrency_limit=1,
                ),
                [(primary_storage, "worker_primary"), (secondary_storage, "worker_secondary")],
            )
        )

    assert sum(claim is not None for claim in claims) == 1
    assert primary_storage._connection.execute(
        "SELECT COUNT(*) FROM runs WHERE status = 'running'"
    ).fetchone()[0] == 1
    secondary_storage.close()
    primary_storage.close()

