import hashlib
import hmac
import time
from textwrap import dedent

from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.schemas import RunInvocation


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
    assert run_payload["execution_mode"] == "manual"

    events_response = client.get(f"/api/runs/{run_id}/events")
    assert events_response.status_code == 200
    events = events_response.json()
    assert any(
        event["node_id"] == "log" and event["type"] == "node_succeeded" for event in events
    )
    assert run_payload["parent_run_id"] is None
    assert run_payload["parent_node_id"] is None


def test_create_run_from_selected_node_only_executes_that_node_and_downstream():
    client = TestClient(create_app(database_path=":memory:"))
    workflow = {
        "id": "wf_run_from_node",
        "name": "Run From Node",
        "nodes": [
            {
                "id": "first",
                "type": "utility.log",
                "position": {"x": 0, "y": 0},
                "config": {"message": "first"},
            },
            {
                "id": "selected",
                "type": "utility.log",
                "position": {"x": 240, "y": 0},
                "config": {"message": "selected"},
            },
            {
                "id": "downstream",
                "type": "utility.log",
                "position": {"x": 480, "y": 0},
                "config": {"message": "downstream"},
            },
        ],
        "edges": [
            {
                "id": "first_selected",
                "source": "first",
                "sourceHandle": "success",
                "target": "selected",
                "targetHandle": "input",
            },
            {
                "id": "selected_downstream",
                "source": "selected",
                "sourceHandle": "success",
                "target": "downstream",
                "targetHandle": "input",
            },
        ],
    }
    assert client.post("/api/workflows", json=workflow).status_code == 200

    run_response = client.post("/api/workflows/wf_run_from_node/runs", json={"entry_node_id": "selected"})

    assert run_response.status_code == 200
    run_id = run_response.json()["id"]
    deadline = time.monotonic() + 2.0
    run_payload = run_response.json()
    while time.monotonic() < deadline:
        run_payload = client.get(f"/api/runs/{run_id}").json()
        if run_payload["status"] in TERMINAL_STATUSES:
            break
        time.sleep(0.05)
    assert run_payload["status"] == "succeeded"

    events = client.get(f"/api/runs/{run_id}/events").json()
    completed_node_ids = {event["node_id"] for event in events if event["type"] == "node_succeeded"}
    assert completed_node_ids == {"selected", "downstream"}
    assert client.app.state.storage.get_run_invocation(run_id).entry_node_id == "selected"


def test_manual_run_input_overrides_the_manual_trigger_for_one_run_and_is_persisted():
    client = TestClient(create_app(database_path=":memory:"))
    workflow = {
        "id": "wf_manual_input",
        "name": "Manual input",
        "nodes": [
            {
                "id": "trigger",
                "type": "manual.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"payload": {"source": "workflow-default"}},
            }
        ],
        "edges": [],
    }
    assert client.post("/api/workflows", json=workflow).status_code == 200

    response = client.post(
        "/api/workflows/wf_manual_input/runs",
        json={"initial_input": {"source": "manual-run", "case_id": 17}},
    )

    assert response.status_code == 200
    run_id = response.json()["id"]
    deadline = time.monotonic() + 2.0
    run = response.json()
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in TERMINAL_STATUSES:
            break
        time.sleep(0.02)

    assert run["status"] == "succeeded"
    invocation = client.app.state.storage.get_run_invocation(run_id)
    assert invocation is not None
    assert invocation.initial_input == {"source": "manual-run", "case_id": 17}
    assert invocation.has_initial_input is True
    events = client.get(f"/api/runs/{run_id}/events").json()
    trigger_output = next(
        event["payload"]["outputs"]["success"]
        for event in events
        if event["type"] == "node_succeeded" and event["node_id"] == "trigger"
    )
    assert trigger_output == {"source": "manual-run", "case_id": 17}


def test_create_run_from_selected_node_rejects_unknown_or_input_dependent_node():
    client = TestClient(create_app(database_path=":memory:"))
    workflow = {
        "id": "wf_run_from_node_validation",
        "name": "Run From Node Validation",
        "nodes": [
            {
                "id": "trigger",
                "type": "manual.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"payload": {"status_code": 200}},
            },
            {
                "id": "assert_status",
                "type": "assert.status_code",
                "position": {"x": 240, "y": 0},
                "config": {"expected": 200},
            },
        ],
        "edges": [
            {
                "id": "trigger_assert",
                "source": "trigger",
                "sourceHandle": "success",
                "target": "assert_status",
                "targetHandle": "input",
            }
        ],
    }
    assert client.post("/api/workflows", json=workflow).status_code == 200

    missing_response = client.post("/api/workflows/wf_run_from_node_validation/runs", json={"entry_node_id": "missing"})
    assert missing_response.status_code == 422
    assert missing_response.json()["detail"] == [
        {
            "path": "entry_node_id",
            "message": "未找到要开始运行的节点：missing",
            "code": "manual_run_entry_missing",
        }
    ]

    dependent_response = client.post(
        "/api/workflows/wf_run_from_node_validation/runs", json={"entry_node_id": "assert_status"}
    )
    assert dependent_response.status_code == 422
    assert dependent_response.json()["detail"] == [
        {
            "path": "nodes.assert_status.inputs.input",
            "message": "从此节点开始运行时，必填输入“响应”不会自动使用上游数据。请改为完整运行，或先调整为可独立运行的节点。",
            "code": "manual_run_required_input",
        }
    ]
    run_count = client.app.state.storage._connection.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
    assert run_count == 0


def test_create_run_from_selected_node_reuses_direct_upstream_pinned_output():
    client = TestClient(create_app(database_path=":memory:"))
    workflow = {
        "id": "wf_run_from_pinned_node",
        "name": "Run From Pinned Node",
        "nodes": [
            {
                "id": "trigger",
                "type": "manual.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"payload": {"status_code": 503}},
                "pinnedData": {"success": {"status_code": 200}},
            },
            {
                "id": "assert_status",
                "type": "assert.status_code",
                "position": {"x": 240, "y": 0},
                "config": {"expected": 200},
            },
        ],
        "edges": [
            {
                "id": "trigger_assert",
                "source": "trigger",
                "sourceHandle": "success",
                "target": "assert_status",
                "targetHandle": "input",
            }
        ],
    }
    assert client.post("/api/workflows", json=workflow).status_code == 200

    run_response = client.post("/api/workflows/wf_run_from_pinned_node/runs", json={"entry_node_id": "assert_status"})

    assert run_response.status_code == 200
    run_id = run_response.json()["id"]
    deadline = time.monotonic() + 2.0
    run_payload = run_response.json()
    while time.monotonic() < deadline:
        run_payload = client.get(f"/api/runs/{run_id}").json()
        if run_payload["status"] in TERMINAL_STATUSES:
            break
        time.sleep(0.05)
    assert run_payload["status"] == "succeeded"

    events = client.get(f"/api/runs/{run_id}/events").json()
    assert {event["node_id"] for event in events if event["type"] == "node_succeeded"} == {"assert_status"}
    pinned_input_event = next(event for event in events if event["type"] == "node_pinned_input_used")
    assert pinned_input_event["node_id"] == "assert_status"
    assert pinned_input_event["payload"] == {
        "source_node_id": "trigger",
        "source_handle": "success",
        "target_handle": "input",
    }


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


def test_list_workflow_runs_returns_recent_runs_for_saved_workflow():
    client = TestClient(create_app(database_path=":memory:"))
    workflow = {
        "id": "wf_history",
        "name": "History Workflow",
        "nodes": [
            {
                "id": "trigger",
                "type": "manual.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"payload": {"ok": True}},
            }
        ],
        "edges": [],
    }

    save_response = client.post("/api/workflows", json=workflow)
    assert save_response.status_code == 200
    first = client.post("/api/workflows/wf_history/runs").json()
    second = client.post("/api/workflows/wf_history/runs").json()

    response = client.get("/api/workflows/wf_history/runs?limit=1")

    assert response.status_code == 200
    assert [run["id"] for run in response.json()] == [second["id"]]
    assert response.json()[0]["workflow_id"] == "wf_history"
    assert response.json()[0]["created_at"] >= first["created_at"]


def test_list_workflow_runs_accepts_an_offset_for_loading_older_history():
    client = TestClient(create_app(database_path=":memory:"))
    workflow = {
        "id": "wf_history_offset",
        "name": "History Offset Workflow",
        "nodes": [
            {
                "id": "trigger",
                "type": "manual.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"payload": {"ok": True}},
            }
        ],
        "edges": [],
    }

    assert client.post("/api/workflows", json=workflow).status_code == 200
    first = client.post("/api/workflows/wf_history_offset/runs").json()
    second = client.post("/api/workflows/wf_history_offset/runs").json()
    third = client.post("/api/workflows/wf_history_offset/runs").json()

    response = client.get("/api/workflows/wf_history_offset/runs?limit=2&offset=2")

    assert response.status_code == 200
    assert [run["id"] for run in response.json()] == [first["id"]]
    assert second["id"] != third["id"]


def test_list_workflow_runs_filters_by_a_valid_run_status():
    client = TestClient(create_app(database_path=":memory:"))
    workflow = {
        "id": "wf_history_status",
        "name": "History Status Workflow",
        "nodes": [
            {
                "id": "trigger",
                "type": "manual.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"payload": {"ok": True}},
            }
        ],
        "edges": [],
    }

    assert client.post("/api/workflows", json=workflow).status_code == 200
    succeeded = client.post("/api/workflows/wf_history_status/runs").json()
    failed = client.post("/api/workflows/wf_history_status/runs").json()
    client.app.state.storage.update_run(succeeded["id"], status="succeeded")
    client.app.state.storage.update_run(failed["id"], status="failed", error="failed")

    response = client.get("/api/workflows/wf_history_status/runs?status=failed")

    assert response.status_code == 200
    assert [run["id"] for run in response.json()] == [failed["id"]]


def test_list_workflow_runs_for_missing_workflow_returns_404():
    client = TestClient(create_app(database_path=":memory:"))

    response = client.get("/api/workflows/missing/runs")

    assert response.status_code == 404
    assert response.json() == {"detail": "Workflow not found"}


def test_cancel_missing_run_returns_404():
    client = TestClient(create_app(database_path=":memory:"))

    response = client.post("/api/runs/missing/cancel")

    assert response.status_code == 404
    assert response.json() == {"detail": "Run not found"}


def test_retry_failed_manual_run_reuses_its_saved_workflow_version_and_records_lineage():
    client = TestClient(create_app(database_path=":memory:", execution_mode="worker"))
    workflow = {
        "id": "wf_retry_version",
        "name": "Retry version",
        "nodes": [
            {
                "id": "start",
                "type": "manual.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"payload": {"version": 1}},
            }
        ],
        "edges": [],
    }
    assert client.post("/api/workflows", json=workflow).status_code == 200
    source_run = client.post(
        "/api/workflows/wf_retry_version/runs",
        json={"initial_input": {"version": "manual-input"}},
    ).json()
    client.app.state.storage.update_run(source_run["id"], status="failed", error="断言失败")

    workflow["nodes"][0]["config"] = {"payload": {"version": 2}}
    assert client.post("/api/workflows", json=workflow).json()["version"] == 2

    response = client.post(f"/api/runs/{source_run['id']}/retry")

    assert response.status_code == 200
    retry_run = response.json()
    assert retry_run["status"] == "queued"
    assert retry_run["execution_mode"] == "manual"
    assert retry_run["workflow_id"] == "wf_retry_version"
    assert retry_run["workflow_version"] == 1
    assert client.app.state.storage.get_run_invocation(retry_run["id"]).model_dump() == {
        "run_mode": "live",
        "entry_node_id": None,
        "initial_input": {"version": "manual-input"},
        "execution_mode": "manual",
        "allow_pinned_data": True,
        "has_initial_input": True,
        "project_variables": {},
        "environment_id": "default",
        "environment_name": "默认环境",
        "credential_overrides": {},
        "profiles": {},
        "parameters": {},
        "configuration": {},
    }
    assert client.get(f"/api/runs/{source_run['id']}/events").json()[-1]["type"] == "run_retry_requested"
    retry_events = client.get(f"/api/runs/{retry_run['id']}/events").json()
    assert retry_events[0]["type"] == "run_retried"
    assert retry_events[0]["payload"] == {
        "source_run_id": source_run["id"],
        "source_workflow_version": 1,
    }


def test_retry_rejects_active_and_non_manual_root_runs():
    client = TestClient(create_app(database_path=":memory:", execution_mode="worker"))
    workflow = {
        "id": "wf_retry_restrictions",
        "name": "Retry restrictions",
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
    assert client.post("/api/workflows", json=workflow).status_code == 200
    active_run = client.post("/api/workflows/wf_retry_restrictions/runs").json()

    active_response = client.post(f"/api/runs/{active_run['id']}/retry")
    assert active_response.status_code == 409
    assert active_response.json() == {"detail": "Only completed failed or cancelled runs can be retried"}

    storage = client.app.state.storage
    storage.update_run(active_run["id"], status="failed", error="失败")
    saved_workflow = storage.get_workflow("wf_retry_restrictions")
    assert saved_workflow is not None
    webhook_run = storage.create_run(
        saved_workflow,
        invocation=RunInvocation(execution_mode="webhook", allow_pinned_data=False),
    )
    storage.update_run(webhook_run.id, status="failed", error="失败")
    webhook_response = client.post(f"/api/runs/{webhook_run.id}/retry")

    assert webhook_response.status_code == 409
    assert webhook_response.json() == {"detail": "Only manual or scheduled root runs can be retried"}


def test_webhook_trigger_runs_saved_workflow_with_request_data():
    client = TestClient(create_app(database_path=":memory:"))
    workflow = {
        "id": "wf_webhook",
        "name": "Webhook Workflow",
        "nodes": [
            {
                "id": "webhook",
                "type": "webhook.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"method": "POST", "path": "hooks/orders"},
            },
            {
                "id": "log",
                "type": "utility.log",
                "position": {"x": 240, "y": 0},
                "config": {"message": "received"},
            },
        ],
        "edges": [
            {
                "id": "webhook_log",
                "source": "webhook",
                "sourceHandle": "success",
                "target": "log",
                "targetHandle": "input",
            }
        ],
    }

    assert client.post("/api/workflows", json=workflow).status_code == 200

    response = client.post("/webhooks/hooks/orders?source=partner", json={"order_id": 42})

    assert response.status_code == 200
    payload = response.json()
    assert payload["run"]["status"] == "succeeded"
    run_id = payload["run"]["id"]
    webhook_started = next(
        event
        for event in client.get(f"/api/runs/{run_id}/events").json()
        if event["node_id"] == "webhook" and event["type"] == "node_started"
    )
    assert webhook_started["payload"]["inputs"] == {}
    webhook_succeeded = next(
        event
        for event in client.get(f"/api/runs/{run_id}/events").json()
        if event["node_id"] == "webhook" and event["type"] == "node_succeeded"
    )
    assert webhook_succeeded["payload"]["outputs"]["success"]["body"] == {"order_id": 42}
    assert webhook_succeeded["payload"]["outputs"]["success"]["query"] == {"source": "partner"}


def test_inactive_webhook_is_unavailable_until_the_workflow_is_enabled():
    client = TestClient(create_app(database_path=":memory:"))
    workflow = {
        "id": "wf_inactive_webhook",
        "name": "Inactive webhook",
        "active": False,
        "nodes": [
            {
                "id": "webhook",
                "type": "webhook.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"method": "POST", "path": "hooks/inactive"},
            }
        ],
        "edges": [],
    }

    assert client.post("/api/workflows", json=workflow).status_code == 200
    assert client.post("/webhooks/hooks/inactive", json={"value": 1}).status_code == 404

    activation = client.post("/api/workflows/wf_inactive_webhook/activation", json={"active": True})

    assert activation.status_code == 200
    assert activation.json()["active"] is True
    assert activation.json()["version"] == 1
    assert client.post("/webhooks/hooks/inactive", json={"value": 1}).status_code == 200


def test_disabled_webhook_does_not_receive_requests_or_block_an_active_binding():
    client = TestClient(create_app(database_path=":memory:"))
    disabled = {
        "id": "wf_disabled_webhook",
        "name": "Disabled Webhook",
        "nodes": [
            {
                "id": "webhook",
                "type": "webhook.trigger",
                "disabled": True,
                "position": {"x": 0, "y": 0},
                "config": {"method": "POST", "path": "hooks/disabled"},
            }
        ],
        "edges": [],
    }
    active = {**disabled, "id": "wf_active_webhook", "name": "Active Webhook"}
    active["nodes"] = [{**disabled["nodes"][0], "disabled": False}]

    assert client.post("/api/workflows", json=disabled).status_code == 200
    assert client.post("/webhooks/hooks/disabled", json={"value": 1}).status_code == 404
    assert client.post("/api/workflows", json=active).status_code == 200
    disabled_after_active = {**disabled, "id": "wf_disabled_webhook_after_active"}
    assert client.post("/api/workflows", json=disabled_after_active).status_code == 200
    assert client.post("/webhooks/hooks/disabled", json={"value": 1}).status_code == 200


def test_webhook_response_node_returns_configured_http_response():
    client = TestClient(create_app(database_path=":memory:"))
    workflow = {
        "id": "wf_webhook_response",
        "name": "Webhook response",
        "nodes": [
            {
                "id": "webhook",
                "type": "webhook.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"method": "POST", "path": "hooks/respond"},
            },
            {
                "id": "respond",
                "type": "webhook.respond",
                "position": {"x": 240, "y": 0},
                "config": {
                    "status_code": 202,
                    "headers": {"x-workflow": "orders"},
                },
            },
        ],
        "edges": [
            {
                "id": "webhook_respond",
                "source": "webhook",
                "sourceHandle": "success",
                "target": "respond",
                "targetHandle": "input",
            }
        ],
    }

    assert client.post("/api/workflows", json=workflow).status_code == 200

    response = client.post("/webhooks/hooks/respond", json={"order_id": 42})

    assert response.status_code == 202
    assert response.headers["x-workflow"] == "orders"
    assert response.json()["body"] == {"order_id": 42}
    assert "run" not in response.json()
    run_id = client.get("/api/workflows/wf_webhook_response/runs").json()[0]["id"]
    response_event = next(
        event
        for event in client.get(f"/api/runs/{run_id}/events").json()
        if event["type"] == "webhook_response_set"
    )
    assert response_event["payload"] == {"status_code": 202, "headers": {"x-workflow": "orders"}}


def test_immediate_webhook_response_queues_the_run_and_returns_accepted():
    with TestClient(create_app(database_path=":memory:")) as client:
        workflow = {
            "id": "wf_webhook_immediate",
            "name": "Immediate webhook",
            "nodes": [
                {
                    "id": "webhook",
                    "type": "webhook.trigger",
                    "position": {"x": 0, "y": 0},
                    "config": {
                        "method": "POST",
                        "path": "hooks/immediate",
                        "response_mode": "immediate",
                    },
                },
                {
                    "id": "delay",
                    "type": "utility.delay",
                    "position": {"x": 240, "y": 0},
                    "config": {"seconds": 0.01},
                },
            ],
            "edges": [
                {
                    "id": "webhook_delay",
                    "source": "webhook",
                    "sourceHandle": "success",
                    "target": "delay",
                    "targetHandle": "input",
                }
            ],
        }

        assert client.post("/api/workflows", json=workflow).status_code == 200

        response = client.post("/webhooks/hooks/immediate", json={"order_id": 42})

        assert response.status_code == 202
        assert response.headers["location"].startswith("/api/runs/")
        assert response.json()["status"] == "accepted"
        run_id = response.json()["run"]["id"]
        assert response.headers["location"] == f"/api/runs/{run_id}"
        assert response.json()["run"]["workflow_id"] == workflow["id"]
        deadline = time.monotonic() + 2.0
        run = response.json()["run"]
        while time.monotonic() < deadline:
            run_response = client.get(f"/api/runs/{run_id}")
            assert run_response.status_code == 200
            run = run_response.json()
            if run["status"] in TERMINAL_STATUSES:
                break
            time.sleep(0.02)
        assert run["status"] == "succeeded"
        assert run["execution_mode"] == "webhook"
        invocation = client.app.state.storage.get_run_invocation(run_id)
        assert invocation is not None
        assert invocation.initial_input["body"] == {"order_id": 42}


def test_immediate_webhook_rejects_a_webhook_response_node():
    client = TestClient(create_app(database_path=":memory:"))
    workflow = {
        "id": "wf_webhook_immediate_response",
        "name": "Immediate response is invalid",
        "nodes": [
            {
                "id": "webhook",
                "type": "webhook.trigger",
                "position": {"x": 0, "y": 0},
                "config": {
                    "method": "POST",
                    "path": "hooks/immediate-response",
                    "response_mode": "immediate",
                },
            },
            {
                "id": "respond",
                "type": "webhook.respond",
                "position": {"x": 240, "y": 0},
                "config": {"status_code": 200, "headers": {}},
            },
        ],
        "edges": [
            {
                "id": "webhook_respond",
                "source": "webhook",
                "sourceHandle": "success",
                "target": "respond",
                "targetHandle": "input",
            }
        ],
    }

    response = client.post("/api/workflows", json=workflow)

    assert response.status_code == 422
    assert response.json()["detail"] == [
        {
            "path": "nodes.respond",
            "message": "立即确认的 Webhook 不能使用 Webhook 响应节点。",
        }
    ]


def test_hmac_signed_webhook_validates_the_raw_request_body_and_redacts_signature():
    client = TestClient(create_app(database_path=":memory:"))
    credential_response = client.post(
        "/api/credentials",
        json={
            "type_id": "webhook.hmac_sha256",
            "name": "GitHub callback signing",
            "data": {"secret": "hmac-secret", "header_name": "X-Hub-Signature-256"},
        },
    )
    assert credential_response.status_code == 201
    credential_id = credential_response.json()["id"]
    workflow = {
        "id": "wf_hmac_webhook",
        "name": "HMAC protected webhook",
        "nodes": [
            {
                "id": "webhook",
                "type": "webhook.trigger",
                "position": {"x": 0, "y": 0},
                "config": {
                    "method": "POST",
                    "path": "hooks/hmac",
                    "credential_id": credential_id,
                },
            }
        ],
        "edges": [],
    }
    assert client.post("/api/workflows", json=workflow).status_code == 200
    raw_body = b'{"delivery":"evt-42", "ok":true}'
    signature = hmac.new(b"hmac-secret", raw_body, hashlib.sha256).hexdigest()

    rejected = client.post(
        "/webhooks/hooks/hmac",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Hub-Signature-256": "sha256=wrong"},
    )
    accepted = client.post(
        "/webhooks/hooks/hmac",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Hub-Signature-256": f"sha256={signature}"},
    )

    assert rejected.status_code == 401
    assert accepted.status_code == 200
    run_id = accepted.json()["run"]["id"]
    webhook_output = next(
        event["payload"]["outputs"]["success"]
        for event in client.get(f"/api/runs/{run_id}/events").json()
        if event["type"] == "node_succeeded" and event["node_id"] == "webhook"
    )
    assert webhook_output["body"] == {"delivery": "evt-42", "ok": True}
    assert webhook_output["headers"]["x-hub-signature-256"] == "***"


def test_webhook_response_is_not_sent_when_the_workflow_fails_afterward():
    client = TestClient(create_app(database_path=":memory:"))
    workflow = {
        "id": "wf_webhook_response_failure",
        "name": "Webhook response failure",
        "nodes": [
            {
                "id": "webhook",
                "type": "webhook.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"method": "POST", "path": "hooks/respond-failure"},
            },
            {
                "id": "respond_first",
                "type": "webhook.respond",
                "position": {"x": 240, "y": 0},
                "config": {"status_code": 201, "headers": {}},
            },
            {
                "id": "respond_second",
                "type": "webhook.respond",
                "position": {"x": 480, "y": 0},
                "config": {"status_code": 202, "headers": {}},
            },
        ],
        "edges": [
            {
                "id": "webhook_respond_first",
                "source": "webhook",
                "sourceHandle": "success",
                "target": "respond_first",
                "targetHandle": "input",
            },
            {
                "id": "respond_first_respond_second",
                "source": "respond_first",
                "sourceHandle": "success",
                "target": "respond_second",
                "targetHandle": "input",
            },
        ],
    }

    assert client.post("/api/workflows", json=workflow).status_code == 200

    response = client.post("/webhooks/hooks/respond-failure", json={"order_id": 42})

    assert response.status_code == 500
    assert response.json()["detail"] == "Webhook workflow failed"


def test_saving_a_duplicate_webhook_binding_returns_a_conflict():
    client = TestClient(create_app(database_path=":memory:"))
    first = {
        "id": "wf_webhook_first",
        "name": "First",
        "nodes": [
            {
                "id": "webhook",
                "type": "webhook.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"method": "POST", "path": "hooks/orders"},
            }
        ],
        "edges": [],
    }
    second = {**first, "id": "wf_webhook_second", "name": "Second"}

    assert client.post("/api/workflows", json=first).status_code == 200
    response = client.post("/api/workflows", json=second)

    assert response.status_code == 409
    assert response.json() == {"detail": "Webhook endpoint is already used by workflow: First"}


def test_webhook_request_only_executes_the_matching_trigger():
    client = TestClient(create_app(database_path=":memory:"))
    workflow = {
        "id": "wf_multiple_webhooks",
        "name": "Multiple Webhooks",
        "nodes": [
            {
                "id": "orders",
                "type": "webhook.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"method": "POST", "path": "hooks/orders"},
            },
            {
                "id": "health",
                "type": "webhook.trigger",
                "position": {"x": 0, "y": 120},
                "config": {"method": "GET", "path": "hooks/health"},
            },
        ],
        "edges": [],
    }
    assert client.post("/api/workflows", json=workflow).status_code == 200

    response = client.post("/webhooks/hooks/orders", json={"order_id": 42})

    assert response.status_code == 200
    events = client.get(f"/api/runs/{response.json()['run']['id']}/events").json()
    assert [event["node_id"] for event in events if event["type"] == "node_started"] == ["orders"]


def test_webhook_header_credential_rejects_unauthorized_requests_and_redacts_the_secret():
    client = TestClient(create_app(database_path=":memory:"))
    credential_response = client.post(
        "/api/credentials",
        json={
            "type_id": "http.header",
            "name": "合作方 Webhook 令牌",
            "data": {"name": "X-Webhook-Token", "value": "webhook-secret-value"},
        },
    )
    assert credential_response.status_code == 201
    credential_id = credential_response.json()["id"]
    workflow = {
        "id": "wf_protected_webhook",
        "name": "Protected Webhook",
        "nodes": [
            {
                "id": "webhook",
                "type": "webhook.trigger",
                "position": {"x": 0, "y": 0},
                "config": {
                    "method": "POST",
                    "path": "hooks/protected",
                    "credential_id": credential_id,
                },
            }
        ],
        "edges": [],
    }
    assert client.post("/api/workflows", json=workflow).status_code == 200

    rejected = client.post("/webhooks/hooks/protected", json={"order_id": 42})

    assert rejected.status_code == 401
    assert rejected.json() == {"detail": "Webhook authentication failed"}
    assert client.get("/api/workflows/wf_protected_webhook/runs").json() == []

    accepted = client.post(
        "/webhooks/hooks/protected",
        headers={"X-Webhook-Token": "webhook-secret-value", "X-Partner": "alpha"},
        json={"order_id": 42},
    )

    assert accepted.status_code == 200
    run_id = accepted.json()["run"]["id"]
    events = client.get(f"/api/runs/{run_id}/events").json()
    webhook_output = next(
        event["payload"]["outputs"]["success"]
        for event in events
        if event["type"] == "node_succeeded" and event["node_id"] == "webhook"
    )
    assert webhook_output["headers"]["x-webhook-token"] == "***"
    assert webhook_output["headers"]["x-partner"] == "alpha"
    invocation = client.app.state.storage.get_run_invocation(run_id)
    assert invocation is not None
    assert invocation.initial_input["headers"]["x-webhook-token"] == "***"


def test_webhook_test_url_runs_a_saved_inactive_workflow_without_exposing_the_production_url():
    client = TestClient(create_app(database_path=":memory:"))
    workflow = {
        "id": "wf_webhook_debug",
        "name": "Webhook Debug",
        "active": False,
        "nodes": [
            {
                "id": "webhook",
                "type": "webhook.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"method": "POST", "path": "hooks/debug"},
            }
        ],
        "edges": [],
    }
    assert client.post("/api/workflows", json=workflow).status_code == 200

    production = client.post("/webhooks/hooks/debug", json={"source": "production"})
    inactive_debug = client.post("/webhooks-test/wf_webhook_debug/hooks/debug", json={"source": "debug"})
    listener = client.post(
        "/api/workflows/wf_webhook_debug/webhook-test/listen",
        json={"node_id": "webhook"},
    )
    listening_status = client.get("/api/workflows/wf_webhook_debug/webhook-test/listen/webhook")
    debug = client.post("/webhooks-test/wf_webhook_debug/hooks/debug", json={"source": "debug"})
    consumed_status = client.get("/api/workflows/wf_webhook_debug/webhook-test/listen/webhook")

    assert production.status_code == 404
    assert inactive_debug.status_code == 409
    assert listener.json()["active"] is True
    assert listener.json()["node_id"] == "webhook"
    assert listening_status.json()["active"] is True
    assert debug.status_code == 200
    run_id = debug.json()["run"]["id"]
    assert debug.json()["run"]["execution_mode"] == "webhook_test"
    assert consumed_status.json()["active"] is False
    assert client.app.state.storage.get_run_invocation(run_id).initial_input["body"] == {"source": "debug"}
    assert client.post("/webhooks-test/wf_webhook_debug/hooks/debug", json={}).status_code == 409
    assert client.post("/webhooks-test/wf_missing/hooks/debug", json={}).status_code == 404
