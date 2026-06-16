from pathlib import Path
from textwrap import dedent

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


def make_temp_registry(tmp_path: Path) -> NodeRegistry:
    (tmp_path / "test_nodes.py").write_text(
        dedent(
            """
            from pydantic import Field

            from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node


            class SourceConfig(NodeConfig):
                payload: dict = Field(default_factory=dict)


            @node(id="test.source", name="Source", category="Test", description="Emit a payload.")
            class SourceNode(BaseNode[SourceConfig]):
                outputs = {"success": Output(description="Payload")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": self.config.payload}


            @node(id="test.pass", name="Pass", category="Test", description="Pass inputs through.")
            class PassNode(BaseNode[NodeConfig]):
                inputs = {"input": Input(required=False)}
                outputs = {"success": Output(description="Inputs")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": inputs}


            @node(id="test.join", name="Join", category="Test", description="Join two inputs.")
            class JoinNode(BaseNode[NodeConfig]):
                inputs = {
                    "left": Input(required=False),
                    "right": Input(required=False),
                    "input": Input(required=False),
                }
                outputs = {"success": Output(description="Joined inputs")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": inputs}


            @node(id="test.error_output", name="Error Output", category="Test", description="Return an error output.")
            class ErrorOutputNode(BaseNode[NodeConfig]):
                outputs = {"error": Output(description="Intentional error output")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"error": {"message": "bad"}}


            @node(id="test.fail", name="Fail", category="Test", description="Always fail.")
            class FailNode(BaseNode[NodeConfig]):
                outputs = {"success": Output(description="Unreachable")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    raise RuntimeError("boom")
            """
        ),
        encoding="utf-8",
    )
    registry = NodeRegistry(nodes_dir=tmp_path)
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


@pytest.mark.asyncio
async def test_executor_records_failed_if_expression():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_if_expression_error",
        name="If Expression Error",
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {}}),
            WorkflowNode(id="if_1", type="logic.if", position=Position(x=200, y=0), config={"condition": "{{ missing.value }}"}),
        ],
        edges=[
            WorkflowEdge(id="e1", source="start", sourceHandle="success", target="if_1", targetHandle="input"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "failed"
    assert any(event.node_id == "if_1" and event.type == "node_started" for event in events)
    failed_events = [
        event for event in events if event.node_id == "if_1" and event.type == "node_failed"
    ]
    assert len(failed_events) == 1
    assert failed_events[0].payload["error"]["message"]
    assert any(event.type == "run_failed" for event in events)


@pytest.mark.asyncio
async def test_executor_fails_run_when_node_raises_without_error_branch(tmp_path):
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_temp_registry(tmp_path)
    workflow = WorkflowDocument(
        id="wf_fail",
        name="Fail",
        nodes=[
            WorkflowNode(id="fail", type="test.fail", position=Position(x=0, y=0), config={}),
        ],
        edges=[],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    stored_run = storage.get_run(run.id)
    events = storage.list_events(run.id)
    assert stored_run is not None
    assert stored_run.status == "failed"
    event_types = [event.type for event in events]
    assert "node_failed" in event_types
    assert "run_failed" in event_types
    assert "run_succeeded" not in event_types


@pytest.mark.asyncio
async def test_executor_fails_run_when_error_output_is_unhandled(tmp_path):
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_temp_registry(tmp_path)
    workflow = WorkflowDocument(
        id="wf_unhandled_error",
        name="Unhandled Error",
        nodes=[
            WorkflowNode(id="error_node", type="test.error_output", position=Position(x=0, y=0), config={}),
        ],
        edges=[],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    stored_run = storage.get_run(run.id)
    events = storage.list_events(run.id)
    assert stored_run is not None
    assert stored_run.status == "failed"
    event_types = [event.type for event in events]
    assert "run_failed" in event_types
    assert "run_succeeded" not in event_types
    assert any(
        event.node_id == "error_node"
        and event.type == "node_succeeded"
        and "error" in event.payload["outputs"]
        for event in events
    )


@pytest.mark.asyncio
async def test_executor_routes_error_output_when_error_edge_exists(tmp_path):
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_temp_registry(tmp_path)
    workflow = WorkflowDocument(
        id="wf_routed_error",
        name="Routed Error",
        nodes=[
            WorkflowNode(id="error_node", type="test.error_output", position=Position(x=0, y=0), config={}),
            WorkflowNode(id="handler", type="test.pass", position=Position(x=200, y=0), config={}),
        ],
        edges=[
            WorkflowEdge(id="e1", source="error_node", sourceHandle="error", target="handler", targetHandle="input"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    stored_run = storage.get_run(run.id)
    events = storage.list_events(run.id)
    assert stored_run is not None
    assert stored_run.status == "succeeded"
    event_types = [event.type for event in events]
    assert "run_succeeded" in event_types
    assert "run_failed" not in event_types
    assert any(event.node_id == "handler" and event.type == "node_succeeded" for event in events)


@pytest.mark.asyncio
async def test_executor_executes_diamond_join_once(tmp_path):
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_temp_registry(tmp_path)
    workflow = WorkflowDocument(
        id="wf_diamond",
        name="Diamond",
        nodes=[
            WorkflowNode(id="start", type="test.source", position=Position(x=0, y=0), config={"payload": {"ok": True}}),
            WorkflowNode(id="left", type="test.pass", position=Position(x=200, y=-100), config={}),
            WorkflowNode(id="right", type="test.pass", position=Position(x=200, y=100), config={}),
            WorkflowNode(id="join", type="test.join", position=Position(x=400, y=0), config={}),
        ],
        edges=[
            WorkflowEdge(id="e1", source="start", sourceHandle="success", target="left", targetHandle="input"),
            WorkflowEdge(id="e2", source="start", sourceHandle="success", target="right", targetHandle="input"),
            WorkflowEdge(id="e3", source="left", sourceHandle="success", target="join", targetHandle="left"),
            WorkflowEdge(id="e4", source="right", sourceHandle="success", target="join", targetHandle="right"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    assert sum(event.node_id == "join" and event.type == "node_started" for event in events) == 1


@pytest.mark.asyncio
async def test_executor_waits_for_multi_root_dependencies(tmp_path):
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_temp_registry(tmp_path)
    workflow = WorkflowDocument(
        id="wf_multi_root",
        name="Multi Root",
        nodes=[
            WorkflowNode(id="left_root", type="test.source", position=Position(x=0, y=-100), config={"payload": {"value": "left"}}),
            WorkflowNode(id="right_root", type="test.source", position=Position(x=0, y=100), config={"payload": {"value": "right"}}),
            WorkflowNode(id="join", type="test.join", position=Position(x=200, y=0), config={}),
        ],
        edges=[
            WorkflowEdge(id="e1", source="left_root", sourceHandle="success", target="join", targetHandle="left"),
            WorkflowEdge(id="e2", source="right_root", sourceHandle="success", target="join", targetHandle="right"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    join_started_events = [
        event for event in events if event.node_id == "join" and event.type == "node_started"
    ]
    assert len(join_started_events) == 1
    assert join_started_events[0].payload["inputs"] == {
        "left": {"value": "left"},
        "right": {"value": "right"},
    }


@pytest.mark.asyncio
async def test_executor_waits_for_late_activated_join_predecessor(tmp_path):
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_temp_registry(tmp_path)
    workflow = WorkflowDocument(
        id="wf_late_predecessor",
        name="Late Predecessor",
        nodes=[
            WorkflowNode(id="direct_root", type="test.source", position=Position(x=0, y=-100), config={"payload": {"value": "direct"}}),
            WorkflowNode(id="cond_root", type="test.source", position=Position(x=0, y=100), config={"payload": {"enabled": True}}),
            WorkflowNode(id="if_1", type="logic.if", position=Position(x=200, y=100), config={"condition": "{{ inputs.input.enabled }}"}),
            WorkflowNode(id="branch", type="test.pass", position=Position(x=400, y=100), config={}),
            WorkflowNode(id="join", type="test.join", position=Position(x=600, y=0), config={}),
        ],
        edges=[
            WorkflowEdge(id="e1", source="direct_root", sourceHandle="success", target="join", targetHandle="left"),
            WorkflowEdge(id="e2", source="cond_root", sourceHandle="success", target="if_1", targetHandle="input"),
            WorkflowEdge(id="e3", source="if_1", sourceHandle="true", target="branch", targetHandle="input"),
            WorkflowEdge(id="e4", source="branch", sourceHandle="success", target="join", targetHandle="right"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    join_started_events = [
        event for event in events if event.node_id == "join" and event.type == "node_started"
    ]
    assert len(join_started_events) == 1
    assert join_started_events[0].payload["inputs"] == {
        "left": {"value": "direct"},
        "right": {"input": {"input": {"enabled": True}}},
    }


@pytest.mark.asyncio
async def test_executor_if_condition_can_read_current_node_inputs():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_if_inputs",
        name="If Inputs",
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {"enabled": False}}),
            WorkflowNode(id="if_1", type="logic.if", position=Position(x=200, y=0), config={"condition": "{{ inputs.input.enabled }}"}),
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
    assert storage.get_run(run.id).status == "succeeded"
    assert any(event.node_id == "false_log" and event.type == "node_succeeded" for event in events)


@pytest.mark.asyncio
async def test_executor_runs_reconverged_if_true_branch_once():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_if_true_reconverge",
        name="If True Reconverge",
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {"enabled": True}}),
            WorkflowNode(id="if_1", type="logic.if", position=Position(x=200, y=0), config={"condition": "{{ inputs.input.enabled }}"}),
            WorkflowNode(id="true_log", type="utility.log", position=Position(x=400, y=-100), config={"message": "true"}),
            WorkflowNode(id="false_log", type="utility.log", position=Position(x=400, y=100), config={"message": "false"}),
            WorkflowNode(id="after", type="utility.log", position=Position(x=600, y=0), config={"message": "after"}),
        ],
        edges=[
            WorkflowEdge(id="e1", source="start", sourceHandle="success", target="if_1", targetHandle="input"),
            WorkflowEdge(id="e2", source="if_1", sourceHandle="true", target="true_log", targetHandle="input"),
            WorkflowEdge(id="e3", source="if_1", sourceHandle="false", target="false_log", targetHandle="input"),
            WorkflowEdge(id="e4", source="true_log", sourceHandle="success", target="after", targetHandle="input"),
            WorkflowEdge(id="e5", source="false_log", sourceHandle="success", target="after", targetHandle="input"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    assert sum(event.node_id == "after" and event.type == "node_started" for event in events) == 1
    assert any(event.node_id == "true_log" and event.type == "node_succeeded" for event in events)
    assert not any(event.node_id == "false_log" and event.type == "node_started" for event in events)


@pytest.mark.asyncio
async def test_executor_runs_reconverged_if_false_branch_once():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_if_false_reconverge",
        name="If False Reconverge",
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {"enabled": False}}),
            WorkflowNode(id="if_1", type="logic.if", position=Position(x=200, y=0), config={"condition": "{{ inputs.input.enabled }}"}),
            WorkflowNode(id="true_log", type="utility.log", position=Position(x=400, y=-100), config={"message": "true"}),
            WorkflowNode(id="false_log", type="utility.log", position=Position(x=400, y=100), config={"message": "false"}),
            WorkflowNode(id="after", type="utility.log", position=Position(x=600, y=0), config={"message": "after"}),
        ],
        edges=[
            WorkflowEdge(id="e1", source="start", sourceHandle="success", target="if_1", targetHandle="input"),
            WorkflowEdge(id="e2", source="if_1", sourceHandle="true", target="true_log", targetHandle="input"),
            WorkflowEdge(id="e3", source="if_1", sourceHandle="false", target="false_log", targetHandle="input"),
            WorkflowEdge(id="e4", source="true_log", sourceHandle="success", target="after", targetHandle="input"),
            WorkflowEdge(id="e5", source="false_log", sourceHandle="success", target="after", targetHandle="input"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    assert sum(event.node_id == "after" and event.type == "node_started" for event in events) == 1
    assert not any(event.node_id == "true_log" and event.type == "node_started" for event in events)
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
