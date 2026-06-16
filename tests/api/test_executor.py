from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from apps.api.nodeflow_api.executor import WorkflowExecutor
from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowEdge, WorkflowNode
from apps.api.nodeflow_api.storage import Storage


def make_registry() -> NodeRegistry:
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    return registry


@pytest.mark.asyncio
async def test_executor_runs_linear_workflow():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_1",
        name="Linear",
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {"name": "Ada"}}),
            WorkflowNode(id="log", type="utility.log", position=Position(x=200, y=0), config={"message": "done"}),
        ],
        edges=[WorkflowEdge(id="e1", source="start", sourceHandle="success", target="log", targetHandle="input")],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)
    await executor.execute(run.id, saved)
    stored_run = storage.get_run(run.id)
    events = storage.list_events(run.id)
    assert stored_run is not None
    assert stored_run.status == "succeeded"
    assert [event.type for event in events if event.node_id == "log"] == ["node_started", "node_succeeded"]


@pytest.mark.asyncio
async def test_executor_routes_if_false_branch():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_if",
        name="If",
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {"enabled": False}}),
            WorkflowNode(id="if_1", type="logic.if", position=Position(x=200, y=0), config={"condition": "{{ nodes.start.outputs.success.enabled }}"}),
            WorkflowNode(id="false_log", type="utility.log", position=Position(x=400, y=100), config={"message": "false"}),
        ],
        edges=[
            WorkflowEdge(id="e1", source="start", sourceHandle="success", target="if_1", targetHandle="input"),
            WorkflowEdge(id="e2", source="if_1", sourceHandle="false", target="false_log", targetHandle="input"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)
    await executor.execute(run.id, saved)
    events = storage.list_events(run.id)
    assert any(event.node_id == "false_log" and event.type == "node_succeeded" for event in events)


def test_create_run_for_missing_workflow_returns_404():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))

    response = client.post("/api/workflows/missing/runs")

    assert response.status_code == 404
    assert response.json() == {"detail": "Workflow not found"}


def test_run_endpoints_create_run_and_list_events_for_saved_workflow():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    workflow = {
        "id": "workflow_run",
        "name": "Run me",
        "nodes": [
            {
                "id": "start",
                "type": "manual.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"payload": {"name": "Ada"}},
            },
            {
                "id": "log",
                "type": "utility.log",
                "position": {"x": 200, "y": 0},
                "config": {"message": "done"},
            },
        ],
        "edges": [
            {
                "id": "e1",
                "source": "start",
                "sourceHandle": "success",
                "target": "log",
                "targetHandle": "input",
            }
        ],
    }

    save_response = client.post("/api/workflows", json=workflow)
    create_response = client.post("/api/workflows/workflow_run/runs")

    assert save_response.status_code == 200
    assert create_response.status_code == 200
    run = create_response.json()
    assert run["workflow_id"] == "workflow_run"
    assert run["status"] in {"queued", "running", "succeeded"}

    run_response = client.get(f"/api/runs/{run['id']}")
    events_response = client.get(f"/api/runs/{run['id']}/events")

    assert run_response.status_code == 200
    assert run_response.json()["status"] == "succeeded"
    assert events_response.status_code == 200
    event_types = [event["type"] for event in events_response.json()]
    assert "run_succeeded" in event_types
    assert any(
        event["node_id"] == "log" and event["type"] == "node_succeeded"
        for event in events_response.json()
    )
