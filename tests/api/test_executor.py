from pathlib import Path
from textwrap import dedent

import httpx
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


            @node(id="test.undeclared_output", name="Undeclared Output", category="Test", description="Return an undeclared output.")
            class UndeclaredOutputNode(BaseNode[NodeConfig]):
                outputs = {"success": Output(description="Declared output")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"typo": {"message": "wrong handle"}}


            @node(id="test.non_dict_output", name="Non Dict Output", category="Test", description="Return a non-dict output.")
            class NonDictOutputNode(BaseNode[NodeConfig]):
                outputs = {"success": Output(description="Declared output")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return ["success"]


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
async def test_executor_records_debug_details_for_successful_nodes():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_observable_success",
        name="Observable Success",
        nodes=[
            WorkflowNode(
                id="start",
                type="manual.trigger",
                position=Position(x=0, y=0),
                config={"payload": {"name": "Ada"}},
            ),
            WorkflowNode(
                id="log",
                type="utility.log",
                position=Position(x=200, y=0),
                config={"message": "created user"},
            ),
        ],
        edges=[
            WorkflowEdge(
                id="e1",
                source="start",
                sourceHandle="success",
                target="log",
                targetHandle="input",
            )
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    log_started = next(
        event for event in events if event.node_id == "log" and event.type == "node_started"
    )
    log_succeeded = next(
        event for event in events if event.node_id == "log" and event.type == "node_succeeded"
    )
    assert log_started.payload["inputs"] == {"input": {"name": "Ada"}}
    assert log_succeeded.payload["outputs"] == {"success": {"input": {"name": "Ada"}}}
    assert log_succeeded.payload["logs"][0]["message"] == "created user"
    assert isinstance(log_succeeded.payload["duration_ms"], int | float)
    assert log_succeeded.payload["duration_ms"] >= 0


@pytest.mark.asyncio
async def test_executor_records_debug_details_for_failed_nodes(tmp_path):
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_temp_registry(tmp_path)
    workflow = WorkflowDocument(
        id="wf_observable_failure",
        name="Observable Failure",
        nodes=[
            WorkflowNode(id="fail", type="test.fail", position=Position(x=0, y=0), config={}),
        ],
        edges=[],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    failed_event = next(
        event for event in storage.list_events(run.id)
        if event.node_id == "fail" and event.type == "node_failed"
    )
    assert failed_event.payload["error"]["message"] == "boom"
    assert isinstance(failed_event.payload["duration_ms"], int | float)
    assert failed_event.payload["duration_ms"] >= 0


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
async def test_executor_fails_run_when_node_returns_undeclared_output(tmp_path):
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_temp_registry(tmp_path)
    workflow = WorkflowDocument(
        id="wf_undeclared_output",
        name="Undeclared Output",
        nodes=[
            WorkflowNode(id="bad", type="test.undeclared_output", position=Position(x=0, y=0), config={}),
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
    failed_events = [
        event for event in events if event.node_id == "bad" and event.type == "node_failed"
    ]
    assert len(failed_events) == 1
    assert "undeclared output" in failed_events[0].payload["error"]["message"].lower()
    assert "typo" in failed_events[0].payload["error"]["message"]
    assert not any(event.node_id == "bad" and event.type == "node_succeeded" for event in events)


@pytest.mark.asyncio
async def test_executor_fails_run_when_node_returns_non_dict_output(tmp_path):
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_temp_registry(tmp_path)
    workflow = WorkflowDocument(
        id="wf_non_dict_output",
        name="Non Dict Output",
        nodes=[
            WorkflowNode(id="bad", type="test.non_dict_output", position=Position(x=0, y=0), config={}),
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
    failed_events = [
        event for event in events if event.node_id == "bad" and event.type == "node_failed"
    ]
    assert len(failed_events) == 1
    assert "dict" in failed_events[0].payload["error"]["message"]
    assert not any(event.node_id == "bad" and event.type == "node_succeeded" for event in events)


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
async def test_executor_transform_resolves_current_node_inputs():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_transform_inputs",
        name="Transform Inputs",
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {"user": {"name": "Ada"}}}),
            WorkflowNode(id="transform", type="utility.transform", position=Position(x=200, y=0), config={"value": "{{ inputs.input.user.name }}"}),
        ],
        edges=[
            WorkflowEdge(id="e1", source="start", sourceHandle="success", target="transform", targetHandle="input"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    succeeded_events = [
        event
        for event in events
        if event.node_id == "transform" and event.type == "node_succeeded"
    ]
    assert len(succeeded_events) == 1
    assert succeeded_events[0].payload["outputs"] == {"success": "Ada"}


@pytest.mark.asyncio
async def test_executor_set_variable_updates_context_for_later_expressions():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_set_variable",
        name="Set Variable",
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {"answer": 42}}),
            WorkflowNode(id="set_answer", type="logic.set_variable", position=Position(x=200, y=0), config={"name": "answer", "value": "{{ inputs.input.answer }}"}),
            WorkflowNode(id="transform", type="utility.transform", position=Position(x=400, y=0), config={"value": "{{ variables.answer }}"}),
        ],
        edges=[
            WorkflowEdge(id="e1", source="start", sourceHandle="success", target="set_answer", targetHandle="input"),
            WorkflowEdge(id="e2", source="set_answer", sourceHandle="success", target="transform", targetHandle="input"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    set_events = [
        event
        for event in events
        if event.node_id == "set_answer" and event.type == "node_succeeded"
    ]
    transform_events = [
        event
        for event in events
        if event.node_id == "transform" and event.type == "node_succeeded"
    ]
    assert len(set_events) == 1
    assert set_events[0].payload["outputs"]["success"]["value"] == 42
    assert set_events[0].payload["outputs"]["success"]["variables"]["answer"] == 42
    assert len(transform_events) == 1
    assert transform_events[0].payload["outputs"] == {"success": 42}


@pytest.mark.asyncio
async def test_executor_records_failed_transform_expression():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_transform_expression_error",
        name="Transform Expression Error",
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {}}),
            WorkflowNode(id="transform", type="utility.transform", position=Position(x=200, y=0), config={"value": "{{ missing.value }}"}),
        ],
        edges=[
            WorkflowEdge(id="e1", source="start", sourceHandle="success", target="transform", targetHandle="input"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "failed"
    assert any(event.node_id == "transform" and event.type == "node_started" for event in events)
    failed_events = [
        event
        for event in events
        if event.node_id == "transform" and event.type == "node_failed"
    ]
    assert len(failed_events) == 1
    assert failed_events[0].payload["error"]["message"]
    assert any(event.type == "run_failed" for event in events)


@pytest.mark.asyncio
async def test_executor_routes_http_request_transport_errors(monkeypatch: pytest.MonkeyPatch):
    async def raise_connect_error(self, method, url, *, headers, json):
        request = httpx.Request(method, url)
        raise httpx.ConnectError("connect failed", request=request)

    monkeypatch.setattr(httpx.AsyncClient, "request", raise_connect_error)
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_http_error",
        name="HTTP Error",
        nodes=[
            WorkflowNode(id="http", type="http.request", position=Position(x=0, y=0), config={"url": "https://example.invalid"}),
            WorkflowNode(id="handler", type="utility.log", position=Position(x=200, y=0), config={"message": "handled"}),
        ],
        edges=[
            WorkflowEdge(id="e1", source="http", sourceHandle="error", target="handler", targetHandle="input"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    http_events = [
        event for event in events if event.node_id == "http" and event.type == "node_succeeded"
    ]
    handler_started = [
        event for event in events if event.node_id == "handler" and event.type == "node_started"
    ]
    assert len(http_events) == 1
    assert http_events[0].payload["outputs"]["error"]["type"] == "ConnectError"
    assert "connect failed" in http_events[0].payload["outputs"]["error"]["message"]
    assert len(handler_started) == 1
    assert handler_started[0].payload["inputs"]["input"]["type"] == "ConnectError"


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
