import time
from textwrap import dedent

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


def test_create_run_revalidates_saved_workflow_against_current_registry(tmp_path):
    nodes_file = tmp_path / "mutable_nodes.py"
    nodes_file.write_text(
        dedent(
            """
            from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node


            @node(id="test.mutable_sink", name="Mutable Sink", category="Test", description="Starts optional.")
            class MutableSinkNode(BaseNode[NodeConfig]):
                inputs = {"input": Input(required=False)}
                outputs = {"success": Output(description="Done")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": inputs}
            """
        ),
        encoding="utf-8",
    )
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))
    workflow = {
        "id": "wf_registry_changed",
        "name": "Registry Changed",
        "nodes": [
            {
                "id": "sink",
                "type": "test.mutable_sink",
                "position": {"x": 0, "y": 0},
                "config": {},
            }
        ],
        "edges": [],
    }
    save_response = client.post("/api/workflows", json=workflow)
    assert save_response.status_code == 200

    nodes_file.write_text(
        dedent(
            """
            from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node


            @node(id="test.mutable_sink", name="Mutable Sink", category="Test", description="Now requires input.")
            class MutableSinkNode(BaseNode[NodeConfig]):
                inputs = {"input": Input(required=True)}
                outputs = {"success": Output(description="Done")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": inputs}
            """
        ),
        encoding="utf-8",
    )
    client.app.state.registry.scan()

    run_response = client.post("/api/workflows/wf_registry_changed/runs")

    assert run_response.status_code == 422
    assert run_response.json()["detail"] == [
        {
            "path": "nodes.sink.inputs.input",
            "message": "Missing required input: input",
        }
    ]
    run_count = client.app.state.storage._connection.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
    assert run_count == 0
