import time
from pathlib import Path

from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app


def test_run_queue_status_exposes_waiting_position_for_a_queued_run(tmp_path):
    app = create_app(
        database_path=tmp_path / "queue-api.sqlite3",
        nodes_dir=Path("nodes"),
        max_concurrent_runs=1,
    )
    workflow = {
        "id": "wf_queue_api",
        "name": "Queue API workflow",
        "nodes": [
            {
                "id": "delay",
                "type": "utility.delay",
                "position": {"x": 0, "y": 0},
                    "config": {"seconds": 1},
            }
        ],
        "edges": [],
    }

    with TestClient(app) as client:
        assert client.post("/api/workflows", json=workflow).status_code == 200
        first_run = client.post("/api/workflows/wf_queue_api/runs").json()
        second_run = client.post("/api/workflows/wf_queue_api/runs").json()

        deadline = time.monotonic() + 1
        response = client.get(f"/api/runs/{second_run['id']}/queue")
        while response.status_code == 200 and response.json() is None and time.monotonic() < deadline:
            time.sleep(0.01)
            response = client.get(f"/api/runs/{second_run['id']}/queue")

        assert response.status_code == 200
        assert response.json() == {
            "run_id": second_run["id"],
            "state": "queued",
            "position": 1,
            "active_count": 1,
            "concurrency_limit": 1,
        }
        assert client.get(f"/api/runs/{first_run['id']}/queue").json()["state"] == "running"


def test_worker_mode_leaves_manual_runs_queued_for_an_external_worker(tmp_path):
    app = create_app(
        database_path=tmp_path / "queue-worker-mode.sqlite3",
        nodes_dir=Path("nodes"),
        max_concurrent_runs=1,
        execution_mode="worker",
    )
    workflow = {
        "id": "wf_worker_mode",
        "name": "Worker mode workflow",
        "nodes": [
            {
                "id": "start",
                "type": "manual.trigger",
                "position": {"x": 0, "y": 0},
                "config": {},
            }
        ],
        "edges": [],
    }

    with TestClient(app) as client:
        assert client.post("/api/workflows", json=workflow).status_code == 200
        run = client.post("/api/workflows/wf_worker_mode/runs").json()

        assert run["status"] == "queued"
        assert client.get(f"/api/runs/{run['id']}").json()["status"] == "queued"
        assert client.get(f"/api/runs/{run['id']}/queue").json() == {
            "run_id": run["id"],
            "state": "queued",
            "position": 1,
            "active_count": 0,
            "concurrency_limit": 1,
        }


def test_create_app_reads_worker_execution_mode_from_the_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("NODE_FLOW_EXECUTION_MODE", "worker")

    app = create_app(database_path=tmp_path / "queue-worker-env.sqlite3", nodes_dir=Path("nodes"))

    assert app.state.execution_mode == "worker"

def test_queue_status_explains_when_a_workflow_concurrency_limit_is_blocking_a_run(tmp_path):
    app = create_app(
        database_path=tmp_path / "queue-workflow-limit.sqlite3",
        nodes_dir=Path("nodes"),
        max_concurrent_runs=4,
        execution_mode="worker",
    )
    workflow = {
        "id": "wf_workflow_limit",
        "name": "Workflow limit queue",
        "settings": {"max_concurrent_runs": 1},
        "nodes": [
            {
                "id": "start",
                "type": "manual.trigger",
                "position": {"x": 0, "y": 0},
                "config": {},
            }
        ],
        "edges": [],
    }

    with TestClient(app) as client:
        assert client.post("/api/workflows", json=workflow).status_code == 200
        first_run = client.post("/api/workflows/wf_workflow_limit/runs").json()
        second_run = client.post("/api/workflows/wf_workflow_limit/runs").json()
        assert client.app.state.storage.claim_next_queued_run("worker_test", lease_seconds=60)

        queue_status = client.get(f"/api/runs/{second_run['id']}/queue").json()

    assert queue_status["workflow_active_count"] == 1
    assert queue_status["workflow_concurrency_limit"] == 1

