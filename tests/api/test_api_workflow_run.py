import time

from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app


TERMINAL_STATUSES = {"succeeded", "failed", "cancelled"}


def test_api_workflow_run_smoke_succeeds_and_records_log_event():
    client = TestClient(create_app(database_path=":memory:"))
    workflow = {
        "id": "wf_smoke",
        "name": "Smoke Workflow",
        "nodes": [
            {
                "id": "trigger",
                "type": "manual.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"payload": {"ok": True}},
            },
            {
                "id": "log",
                "type": "utility.log",
                "position": {"x": 240, "y": 0},
                "config": {"message": "done"},
            },
        ],
        "edges": [
            {
                "id": "edge_trigger_log",
                "source": "trigger",
                "sourceHandle": "success",
                "target": "log",
                "targetHandle": "input",
            }
        ],
    }

    save_response = client.post("/api/workflows", json=workflow)
    assert save_response.status_code == 200

    run_response = client.post("/api/workflows/wf_smoke/runs")
    assert run_response.status_code == 200
    run_id = run_response.json()["id"]

    run_payload = None
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline:
        get_run_response = client.get(f"/api/runs/{run_id}")
        assert get_run_response.status_code == 200
        run_payload = get_run_response.json()
        if run_payload["status"] in TERMINAL_STATUSES:
            break
        time.sleep(0.05)

    assert run_payload is not None
    assert run_payload["status"] == "succeeded"

    events_response = client.get(f"/api/runs/{run_id}/events")
    assert events_response.status_code == 200
    events = events_response.json()
    assert any(
        event["node_id"] == "log" and event["type"] == "node_succeeded" for event in events
    )
