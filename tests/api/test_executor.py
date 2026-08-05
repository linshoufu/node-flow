import asyncio
import time
from pathlib import Path
from textwrap import dedent

import httpx
import pytest
from fastapi.testclient import TestClient

from apps.api.nodeflow_api.credentials import CredentialVault
from apps.api.nodeflow_api.executor import ExecutionContext, WorkflowExecutor
from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import (
    Position,
    RunInvocation,
    WorkflowDocument,
    WorkflowEdge,
    WorkflowNode,
    WorkflowSettings,
)
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


            @node(id="test.multi_join", name="Multi Join", category="Test", description="Collect repeated inputs.")
            class MultiJoinNode(BaseNode[NodeConfig]):
                inputs = {"items": Input(required=False, max_connections=None)}
                outputs = {"success": Output(description="Collected inputs")}

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


            @node(id="test.fail_with_error_output", name="Fail With Error Output", category="Test", description="Always fail with an error port.")
            class FailWithErrorOutputNode(BaseNode[NodeConfig]):
                outputs = {"error": Output(description="Execution error")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    raise RuntimeError("boom")


            class FlakyConfig(NodeConfig):
                failures_before_success: int = 1


            @node(id="test.flaky", name="Flaky", category="Test", description="Fails before succeeding.")
            class FlakyNode(BaseNode[FlakyConfig]):
                attempts_by_node_id: dict[str, int] = {}
                outputs = {"success": Output(description="Eventually succeeds")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    attempt = self.attempts_by_node_id.get(ctx.node_id, 0) + 1
                    self.attempts_by_node_id[ctx.node_id] = attempt
                    if attempt <= self.config.failures_before_success:
                        raise RuntimeError(f"flaky attempt {attempt}")
                    return {"success": {"attempt": attempt}}
            """
        ),
        encoding="utf-8",
    )
    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()
    return registry


def write_reloadable_node_file(path: Path, *, version: str) -> None:
    path.write_text(
        dedent(
            f'''
            import asyncio

            from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node


            @node(id="test.snapshot_pause", name="Snapshot Pause", category="Test")
            class SnapshotPauseNode(BaseNode[NodeConfig]):
                outputs = {{"success": Output(description="Done")}}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    await asyncio.sleep(0.05)
                    return {{"success": {{}}}}


            @node(id="test.snapshot_version", name="Snapshot Version", category="Test")
            class SnapshotVersionNode(BaseNode[NodeConfig]):
                inputs = {{"input": Input(required=False)}}
                outputs = {{"success": Output(description="Version")}}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {{"success": {{"version": "{version}"}}}}
            '''
        ),
        encoding="utf-8",
    )


def write_versioned_runtime_node_file(path: Path) -> None:
    path.write_text(
        dedent(
            '''
            from nodeflow_sdk import BaseNode, NodeConfig, NodeContext, Output, node


            @node(id="test.runtime_version", name="Runtime Version", category="Test", version=2)
            class RuntimeVersionNode(BaseNode[NodeConfig]):
                outputs = {"success": Output(description="Done")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": {"ran": True}}
            '''
        ),
        encoding="utf-8",
    )


@pytest.mark.asyncio
async def test_executor_rejects_a_queued_workflow_with_an_outdated_node_version(tmp_path):
    write_versioned_runtime_node_file(tmp_path / "versioned.py")
    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = storage.save_workflow(
        WorkflowDocument(
            id="wf_outdated_runtime_node",
            name="Outdated runtime node",
            nodes=[
                WorkflowNode(
                    id="versioned",
                    type="test.runtime_version",
                    typeVersion=1,
                    position=Position(x=0, y=0),
                    config={},
                )
            ],
            edges=[],
        )
    )
    run = storage.create_run(workflow)

    await WorkflowExecutor(storage=storage, registry=registry).execute(run.id, workflow)

    completed_run = storage.get_run(run.id)
    assert completed_run is not None
    assert completed_run.status == "failed"
    assert completed_run.error is not None
    assert "test.runtime_version" in completed_run.error
    assert not any(event.node_id == "versioned" and event.type == "node_started" for event in storage.list_events(run.id))


@pytest.mark.asyncio
async def test_executor_freezes_node_definitions_for_each_running_workflow(tmp_path):
    node_file = tmp_path / "reloadable.py"
    write_reloadable_node_file(node_file, version="before-reload")
    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = storage.save_workflow(
        WorkflowDocument(
            id="wf_node_snapshot",
            name="Node definition snapshot",
            nodes=[
                WorkflowNode(id="pause", type="test.snapshot_pause", position=Position(x=0, y=0), config={}),
                WorkflowNode(id="version", type="test.snapshot_version", position=Position(x=240, y=0), config={}),
            ],
            edges=[
                WorkflowEdge(
                    id="pause_version",
                    source="pause",
                    sourceHandle="success",
                    target="version",
                    targetHandle="input",
                )
            ],
        )
    )
    executor = WorkflowExecutor(storage=storage, registry=registry)
    first_run = storage.create_run(workflow)
    first_execution = asyncio.create_task(executor.execute(first_run.id, workflow))

    for _ in range(20):
        if any(event.node_id == "pause" and event.type == "node_started" for event in storage.list_events(first_run.id)):
            break
        await asyncio.sleep(0.005)
    else:
        pytest.fail("The pause node did not start")

    write_reloadable_node_file(node_file, version="after-reload")
    registry.scan()
    await first_execution

    first_output = next(
        event.payload["outputs"]["success"]
        for event in storage.list_events(first_run.id)
        if event.node_id == "version" and event.type == "node_succeeded"
    )
    assert first_output == {"version": "before-reload"}

    second_run = storage.create_run(workflow)
    await executor.execute(second_run.id, workflow)
    second_output = next(
        event.payload["outputs"]["success"]
        for event in storage.list_events(second_run.id)
        if event.node_id == "version" and event.type == "node_succeeded"
    )
    assert second_output == {"version": "after-reload"}


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
async def test_executor_runs_configured_error_workflow_with_failure_context():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    error_workflow = storage.save_workflow(
        WorkflowDocument(
            id="wf_error_handler",
            name="Error handler",
            nodes=[WorkflowNode(id="trigger", type="workflow.trigger", position=Position(x=0, y=0), config={})],
            edges=[],
        )
    )
    parent = storage.save_workflow(
        WorkflowDocument(
            id="wf_failing_parent",
            name="Failing parent",
            settings=WorkflowSettings(error_workflow_id=error_workflow.id),
            nodes=[
                WorkflowNode(
                    id="fail",
                    type="workflow.execute",
                    position=Position(x=0, y=0),
                    config={"workflow_id": "missing_workflow"},
                )
            ],
            edges=[],
        )
    )
    parent_run = storage.create_run(parent)

    await WorkflowExecutor(storage=storage, registry=registry).execute(parent_run.id, parent)

    error_run = storage.list_workflow_runs(error_workflow.id)[0]
    invocation = storage.get_run_invocation(error_run.id)
    parent_events = storage.list_events(parent_run.id)
    assert storage.get_run(parent_run.id).status == "failed"
    assert error_run.status == "succeeded"
    assert error_run.execution_mode == "error"
    assert error_run.parent_run_id == parent_run.id
    assert error_run.parent_node_id is None
    assert invocation is not None
    failure_context = invocation.initial_input["execution"]
    assert failure_context["run_id"] == parent_run.id
    assert failure_context["workflow_id"] == parent.id
    assert failure_context["workflow_name"] == parent.name
    assert failure_context["workflow_version"] == parent.version
    assert "missing_workflow" in failure_context["error"]
    assert [event.type for event in parent_events if event.type.startswith("error_workflow_")] == [
        "error_workflow_started",
        "error_workflow_succeeded",
    ]


@pytest.mark.asyncio
async def test_error_workflow_failure_does_not_recursively_start_another_error_workflow():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    error_workflow = storage.save_workflow(
        WorkflowDocument(
            id="wf_failing_error_handler",
            name="Failing error handler",
            nodes=[
                WorkflowNode(id="trigger", type="workflow.trigger", position=Position(x=0, y=0), config={}),
                WorkflowNode(
                    id="fail",
                    type="workflow.execute",
                    position=Position(x=220, y=0),
                    config={"workflow_id": "missing_workflow"},
                ),
            ],
            edges=[WorkflowEdge(id="error_edge", source="trigger", sourceHandle="success", target="fail", targetHandle="input")],
        )
    )
    parent = storage.save_workflow(
        WorkflowDocument(
            id="wf_parent_with_failing_handler",
            name="Parent with failing handler",
            settings=WorkflowSettings(error_workflow_id=error_workflow.id),
            nodes=[
                WorkflowNode(
                    id="fail",
                    type="workflow.execute",
                    position=Position(x=0, y=0),
                    config={"workflow_id": "missing_workflow"},
                )
            ],
            edges=[],
        )
    )
    parent_run = storage.create_run(parent)

    await WorkflowExecutor(storage=storage, registry=registry).execute(parent_run.id, parent)

    assert len(storage.list_workflow_runs(error_workflow.id)) == 1
    assert storage.list_workflow_runs(error_workflow.id)[0].status == "failed"
    assert any(event.type == "error_workflow_failed" for event in storage.list_events(parent_run.id))


@pytest.mark.asyncio
async def test_executor_skips_disabled_nodes_and_passes_their_input_to_the_primary_output(tmp_path):
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_temp_registry(tmp_path)
    workflow = WorkflowDocument(
        id="wf_disabled",
        name="Disabled node",
        nodes=[
            WorkflowNode(id="source", type="test.source", position=Position(x=0, y=0), config={"payload": {"id": 7}}),
            WorkflowNode(id="disabled", type="test.pass", position=Position(x=240, y=0), config={}, disabled=True),
            WorkflowNode(id="after", type="test.pass", position=Position(x=480, y=0), config={}),
        ],
        edges=[
            WorkflowEdge(id="source_disabled", source="source", sourceHandle="success", target="disabled", targetHandle="input"),
            WorkflowEdge(id="disabled_after", source="disabled", sourceHandle="success", target="after", targetHandle="input"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)

    await WorkflowExecutor(storage=storage, registry=registry).execute(run.id, saved)

    events = storage.list_events(run.id)
    skipped = next(event for event in events if event.node_id == "disabled" and event.type == "node_skipped")
    assert skipped.payload == {"reason": "disabled", "outputs": {"success": {"id": 7}}}
    assert not any(event.node_id == "disabled" and event.type == "node_started" for event in events)
    assert any(event.node_id == "after" and event.type == "node_succeeded" for event in events)


@pytest.mark.asyncio
async def test_execute_workflow_creates_linked_child_run_and_returns_explicit_value():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    child = storage.save_workflow(
        WorkflowDocument(
            id="wf_child",
            name="Child",
            nodes=[
                WorkflowNode(
                    id="child_start",
                    type="workflow.trigger",
                    position=Position(x=0, y=0),
                    config={},
                ),
                WorkflowNode(
                    id="child_return",
                    type="workflow.return",
                    position=Position(x=200, y=0),
                    config={},
                ),
            ],
            edges=[
                WorkflowEdge(
                    id="child_edge",
                    source="child_start",
                    sourceHandle="success",
                    target="child_return",
                    targetHandle="input",
                )
            ],
        )
    )
    parent = storage.save_workflow(
        WorkflowDocument(
            id="wf_parent",
            name="Parent",
            nodes=[
                WorkflowNode(
                    id="start",
                    type="manual.trigger",
                    position=Position(x=0, y=0),
                    config={"payload": {"answer": 42}},
                ),
                WorkflowNode(
                    id="call_child",
                    type="workflow.execute",
                    position=Position(x=200, y=0),
                    config={"workflow_id": child.id},
                ),
            ],
            edges=[
                WorkflowEdge(
                    id="parent_edge",
                    source="start",
                    sourceHandle="success",
                    target="call_child",
                    targetHandle="input",
                )
            ],
        )
    )
    parent_run = storage.create_run(parent)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(parent_run.id, parent)

    child_runs = storage.list_workflow_runs(child.id)
    assert len(child_runs) == 1
    child_run = child_runs[0]
    assert child_run.parent_run_id == parent_run.id
    assert child_run.parent_node_id == "call_child"
    assert child_run.status == "succeeded"
    assert storage.get_run(parent_run.id).status == "succeeded"
    call_succeeded = next(
        event
        for event in storage.list_events(parent_run.id)
        if event.node_id == "call_child" and event.type == "node_succeeded"
    )
    assert call_succeeded.payload["outputs"] == {"success": {"answer": 42}}
    assert [
        event.type for event in storage.list_events(parent_run.id) if event.type.startswith("child_run_")
    ] == ["child_run_started", "child_run_succeeded"]


@pytest.mark.asyncio
async def test_child_workflow_secret_is_redacted_in_parent_run_events(
    monkeypatch: pytest.MonkeyPatch,
):
    async def echo_secret(self, method, url, *, headers, json):
        return httpx.Response(200, json={"echo": "child-run-secret"})

    monkeypatch.setattr(httpx.AsyncClient, "request", echo_secret)
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    credential = storage.create_credential(
        type_id="http.bearer",
        name="Child run credential",
        encrypted_data=CredentialVault().encrypt({"token": "child-run-secret"}),
    )
    child = storage.save_workflow(
        WorkflowDocument(
            id="wf_child_secret",
            name="Child secret",
            nodes=[
                WorkflowNode(id="child_start", type="workflow.trigger", position=Position(x=0, y=0), config={}),
                WorkflowNode(
                    id="child_http",
                    type="http.request",
                    position=Position(x=200, y=0),
                    config={"url": "https://example.test/child", "credential_id": credential.id},
                ),
                WorkflowNode(id="child_return", type="workflow.return", position=Position(x=400, y=0), config={}),
            ],
            edges=[
                WorkflowEdge(
                    id="child_request",
                    source="child_start",
                    sourceHandle="success",
                    target="child_http",
                    targetHandle="body",
                ),
                WorkflowEdge(
                    id="child_return_edge",
                    source="child_http",
                    sourceHandle="success",
                    target="child_return",
                    targetHandle="input",
                ),
            ],
        )
    )
    parent = storage.save_workflow(
        WorkflowDocument(
            id="wf_parent_secret",
            name="Parent secret",
            nodes=[
                WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {}}),
                WorkflowNode(
                    id="call_child",
                    type="workflow.execute",
                    position=Position(x=200, y=0),
                    config={"workflow_id": child.id},
                ),
            ],
            edges=[
                WorkflowEdge(
                    id="parent_call",
                    source="start",
                    sourceHandle="success",
                    target="call_child",
                    targetHandle="input",
                )
            ],
        )
    )
    parent_run = storage.create_run(parent)

    await WorkflowExecutor(storage=storage, registry=registry).execute(parent_run.id, parent)

    parent_events = str([event.payload for event in storage.list_events(parent_run.id)])
    assert storage.get_run(parent_run.id).status == "succeeded"
    assert "child-run-secret" not in parent_events

@pytest.mark.asyncio
async def test_execute_workflow_cancellation_propagates_to_running_child():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    child = storage.save_workflow(
        WorkflowDocument(
            id="wf_child_delay",
            name="Delayed child",
            nodes=[
                WorkflowNode(
                    id="child_start",
                    type="workflow.trigger",
                    position=Position(x=0, y=0),
                    config={},
                ),
                WorkflowNode(
                    id="delay",
                    type="utility.delay",
                    position=Position(x=200, y=0),
                    config={"seconds": 1},
                ),
            ],
            edges=[
                WorkflowEdge(
                    id="child_edge",
                    source="child_start",
                    sourceHandle="success",
                    target="delay",
                    targetHandle="input",
                )
            ],
        )
    )
    parent = storage.save_workflow(
        WorkflowDocument(
            id="wf_parent_cancel",
            name="Parent cancellation",
            nodes=[
                WorkflowNode(
                    id="start",
                    type="manual.trigger",
                    position=Position(x=0, y=0),
                    config={"payload": {}},
                ),
                WorkflowNode(
                    id="call_child",
                    type="workflow.execute",
                    position=Position(x=200, y=0),
                    config={"workflow_id": child.id},
                ),
            ],
            edges=[
                WorkflowEdge(
                    id="parent_edge",
                    source="start",
                    sourceHandle="success",
                    target="call_child",
                    targetHandle="input",
                )
            ],
        )
    )
    parent_run = storage.create_run(parent)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    task = asyncio.create_task(executor.execute(parent_run.id, parent))
    for _ in range(50):
        child_runs = storage.list_workflow_runs(child.id)
        if child_runs and child_runs[0].status == "running":
            break
        await asyncio.sleep(0.01)
    else:
        pytest.fail("Child run did not start")
    assert storage.request_run_cancel(parent_run.id) is True
    await task

    assert storage.get_run(parent_run.id).status == "cancelled"
    assert storage.get_run(child_runs[0].id).status == "cancelled"


@pytest.mark.asyncio
async def test_execute_workflow_rejects_recursive_target_before_creating_child_run():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = storage.save_workflow(
        WorkflowDocument(
            id="wf_recursive",
            name="Recursive",
            nodes=[
                WorkflowNode(
                    id="start",
                    type="manual.trigger",
                    position=Position(x=0, y=0),
                    config={"payload": {}},
                ),
                WorkflowNode(
                    id="call_self",
                    type="workflow.execute",
                    position=Position(x=200, y=0),
                    config={"workflow_id": "wf_recursive"},
                ),
            ],
            edges=[
                WorkflowEdge(
                    id="edge",
                    source="start",
                    sourceHandle="success",
                    target="call_self",
                    targetHandle="input",
                )
            ],
        )
    )
    run = storage.create_run(workflow)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, workflow)

    assert storage.get_run(run.id).status == "failed"
    assert len(storage.list_workflow_runs(workflow.id)) == 1


@pytest.mark.asyncio
async def test_execute_workflow_requires_a_single_trigger_root_before_creating_child_run():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    child = storage.save_workflow(
        WorkflowDocument(
            id="wf_bad_child",
            name="Bad child",
            nodes=[
                WorkflowNode(
                    id="start",
                    type="manual.trigger",
                    position=Position(x=0, y=0),
                    config={"payload": {}},
                )
            ],
        )
    )
    parent = storage.save_workflow(
        WorkflowDocument(
            id="wf_parent_bad_child",
            name="Parent",
            nodes=[
                WorkflowNode(
                    id="start",
                    type="manual.trigger",
                    position=Position(x=0, y=0),
                    config={"payload": {}},
                ),
                WorkflowNode(
                    id="call_child",
                    type="workflow.execute",
                    position=Position(x=200, y=0),
                    config={"workflow_id": child.id},
                ),
            ],
            edges=[
                WorkflowEdge(
                    id="edge",
                    source="start",
                    sourceHandle="success",
                    target="call_child",
                    targetHandle="input",
                )
            ],
        )
    )
    run = storage.create_run(parent)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, parent)

    assert storage.get_run(run.id).status == "failed"
    assert storage.list_workflow_runs(child.id) == []


@pytest.mark.asyncio
async def test_child_failure_uses_calling_node_error_output_policy():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    child = storage.save_workflow(
        WorkflowDocument(
            id="wf_failing_child",
            name="Failing child",
            nodes=[
                WorkflowNode(
                    id="child_start",
                    type="workflow.trigger",
                    position=Position(x=0, y=0),
                    config={},
                ),
                WorkflowNode(
                    id="fail",
                    type="utility.transform",
                    position=Position(x=200, y=0),
                    config={"value": "{{ nodes.missing.outputs.success }}"},
                ),
            ],
            edges=[
                WorkflowEdge(
                    id="child_edge",
                    source="child_start",
                    sourceHandle="success",
                    target="fail",
                    targetHandle="input",
                )
            ],
        )
    )
    parent = storage.save_workflow(
        WorkflowDocument(
            id="wf_parent_error_output",
            name="Parent error output",
            nodes=[
                WorkflowNode(
                    id="start",
                    type="manual.trigger",
                    position=Position(x=0, y=0),
                    config={"payload": {}},
                ),
                WorkflowNode(
                    id="call_child",
                    type="workflow.execute",
                    position=Position(x=200, y=0),
                    config={"workflow_id": child.id},
                    execution={"onError": "errorOutput"},
                ),
                WorkflowNode(
                    id="handled",
                    type="utility.log",
                    position=Position(x=400, y=0),
                    config={"message": "handled"},
                ),
            ],
            edges=[
                WorkflowEdge(
                    id="parent_input",
                    source="start",
                    sourceHandle="success",
                    target="call_child",
                    targetHandle="input",
                ),
                WorkflowEdge(
                    id="parent_error",
                    source="call_child",
                    sourceHandle="error",
                    target="handled",
                    targetHandle="input",
                ),
            ],
        )
    )
    run = storage.create_run(parent)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, parent)

    assert storage.get_run(run.id).status == "succeeded"
    handled = next(
        event
        for event in storage.list_events(run.id)
        if event.node_id == "handled" and event.type == "node_started"
    )
    assert handled.payload["inputs"]["input"]["type"] == "WorkflowExecutionError"


@pytest.mark.asyncio
async def test_child_workflow_cannot_outlive_parent_deadline():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    child = storage.save_workflow(
        WorkflowDocument(
            id="wf_child_timeout",
            name="Slow child",
            nodes=[
                WorkflowNode(
                    id="child_start",
                    type="workflow.trigger",
                    position=Position(x=0, y=0),
                    config={},
                ),
                WorkflowNode(
                    id="delay",
                    type="utility.delay",
                    position=Position(x=200, y=0),
                    config={"seconds": 1},
                ),
            ],
            edges=[
                WorkflowEdge(
                    id="child_edge",
                    source="child_start",
                    sourceHandle="success",
                    target="delay",
                    targetHandle="input",
                )
            ],
        )
    )
    parent = storage.save_workflow(
        WorkflowDocument(
            id="wf_parent_timeout",
            name="Timeout parent",
            settings=WorkflowSettings(timeout_seconds=0.05),
            nodes=[
                WorkflowNode(
                    id="start",
                    type="manual.trigger",
                    position=Position(x=0, y=0),
                    config={"payload": {}},
                ),
                WorkflowNode(
                    id="call_child",
                    type="workflow.execute",
                    position=Position(x=200, y=0),
                    config={"workflow_id": child.id},
                ),
            ],
            edges=[
                WorkflowEdge(
                    id="parent_edge",
                    source="start",
                    sourceHandle="success",
                    target="call_child",
                    targetHandle="input",
                )
            ],
        )
    )
    parent_run = storage.create_run(parent)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(parent_run.id, parent)

    child_run = storage.list_workflow_runs(child.id)[0]
    assert storage.get_run(parent_run.id).status == "failed"
    assert child_run.status == "failed"
    assert child_run.error


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
async def test_executor_continue_policy_handles_failure_and_allows_independent_branch(tmp_path):
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_temp_registry(tmp_path)
    workflow = WorkflowDocument(
        id="wf_continue_failure",
        name="Continue Failure",
        nodes=[
            WorkflowNode(
                id="fail",
                type="test.fail",
                position=Position(x=0, y=0),
                config={},
                execution={"onError": "continue"},
            ),
            WorkflowNode(
                id="source",
                type="test.source",
                position=Position(x=0, y=100),
                config={"payload": {"ok": True}},
            ),
            WorkflowNode(
                id="independent",
                type="test.pass",
                position=Position(x=200, y=100),
                config={},
            ),
        ],
        edges=[
            WorkflowEdge(
                id="source_independent",
                source="source",
                sourceHandle="success",
                target="independent",
                targetHandle="input",
            )
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    assert [event.type for event in events if event.node_id == "fail"] == [
        "node_started",
        "node_failed",
        "node_error_handled",
    ]
    assert any(event.node_id == "independent" and event.type == "node_succeeded" for event in events)


@pytest.mark.asyncio
async def test_executor_retries_a_node_then_succeeds(tmp_path):
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_temp_registry(tmp_path)
    workflow = WorkflowDocument(
        id="wf_retry",
        name="Retry",
        nodes=[
            WorkflowNode(
                id="flaky",
                type="test.flaky",
                position=Position(x=0, y=0),
                config={"failures_before_success": 1},
                execution={"retry": {"maxAttempts": 2, "delaySeconds": 0}},
            )
        ],
        edges=[],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    assert [event.type for event in events if event.node_id == "flaky"] == [
        "node_started",
        "node_failed",
        "node_retry_scheduled",
        "node_started",
        "node_succeeded",
    ]
    retry = next(event for event in events if event.type == "node_retry_scheduled")
    assert retry.payload["attempt"] == 1
    assert retry.payload["next_attempt"] == 2
    started_events = [event for event in events if event.type == "node_started" and event.node_id == "flaky"]
    succeeded_event = next(event for event in events if event.type == "node_succeeded" and event.node_id == "flaky")
    assert [event.payload["attempt"] for event in started_events] == [1, 2]
    assert succeeded_event.payload["attempt"] == 2


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
async def test_executor_routes_policy_error_to_error_output(tmp_path):
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_temp_registry(tmp_path)
    workflow = WorkflowDocument(
        id="wf_policy_error_output",
        name="Policy Error Output",
        nodes=[
            WorkflowNode(
                id="fail",
                type="test.fail_with_error_output",
                position=Position(x=0, y=0),
                config={},
                execution={"onError": "errorOutput"},
            ),
            WorkflowNode(id="handler", type="test.pass", position=Position(x=200, y=0), config={}),
        ],
        edges=[
            WorkflowEdge(id="fail_handler", source="fail", sourceHandle="error", target="handler", targetHandle="input"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    handled = next(event for event in events if event.node_id == "fail" and event.type == "node_error_handled")
    handler_started = next(event for event in events if event.node_id == "handler" and event.type == "node_started")
    assert storage.get_run(run.id).status == "succeeded"
    assert handled.payload["mode"] == "errorOutput"
    assert handled.payload["outputs"]["error"]["message"] == "boom"
    assert handler_started.payload["inputs"]["input"]["type"] == "RuntimeError"


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
async def test_executor_collects_multi_connection_input_values(tmp_path):
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_temp_registry(tmp_path)
    workflow = WorkflowDocument(
        id="wf_multi_connection_input",
        name="Multi Connection Input",
        nodes=[
            WorkflowNode(id="left_root", type="test.source", position=Position(x=0, y=-100), config={"payload": {"value": "left"}}),
            WorkflowNode(id="right_root", type="test.source", position=Position(x=0, y=100), config={"payload": {"value": "right"}}),
            WorkflowNode(id="collector", type="test.multi_join", position=Position(x=200, y=0), config={}),
        ],
        edges=[
            WorkflowEdge(id="e1", source="left_root", sourceHandle="success", target="collector", targetHandle="items"),
            WorkflowEdge(id="e2", source="right_root", sourceHandle="success", target="collector", targetHandle="items"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    collector_started = [
        event for event in storage.list_events(run.id) if event.node_id == "collector" and event.type == "node_started"
    ]
    assert storage.get_run(run.id).status == "succeeded"
    assert collector_started[0].payload["inputs"] == {
        "items": [{"value": "left"}, {"value": "right"}],
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
async def test_executor_resolves_workflow_settings_variables_as_vars():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_settings_variables",
        name="Settings Variables",
        settings={"variables": {"base_url": "https://api.example.com", "retry_count": 3}},
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {}}),
            WorkflowNode(
                id="transform",
                type="utility.transform",
                position=Position(x=200, y=0),
                config={"value": {"url": "{{ vars.base_url }}/health", "retries": "{{ vars.retry_count }}"}},
            ),
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
    transform_events = [
        event
        for event in events
        if event.node_id == "transform" and event.type == "node_succeeded"
    ]
    assert len(transform_events) == 1
    assert transform_events[0].payload["outputs"] == {
        "success": {"url": "https://api.example.com/health", "retries": 3}
    }


@pytest.mark.asyncio
async def test_executor_resolves_project_variables_from_the_run_snapshot():
    storage = Storage(":memory:")
    storage.init_schema()
    storage.create_project_variable(name="base_url", value="https://first.example.com")
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_project_variables",
        name="Project Variables",
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {}}),
            WorkflowNode(
                id="transform",
                type="utility.transform",
                position=Position(x=200, y=0),
                config={"value": "{{ project.base_url }}/health"},
            ),
        ],
        edges=[WorkflowEdge(id="e1", source="start", sourceHandle="success", target="transform", targetHandle="input")],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    storage.update_project_variable("base_url", value="https://later.example.com")

    await WorkflowExecutor(storage=storage, registry=registry).execute(run.id, saved)

    transform_event = next(
        event
        for event in storage.list_events(run.id)
        if event.node_id == "transform" and event.type == "node_succeeded"
    )
    invocation = storage.get_run_invocation(run.id)
    assert invocation is not None
    assert invocation.project_variables == {"base_url": "https://first.example.com"}
    assert transform_event.payload["outputs"] == {"success": "https://first.example.com/health"}


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
async def test_manual_execution_uses_pinned_node_output_without_evaluating_node_config():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_pinned_output",
        name="Pinned output",
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {}}),
            WorkflowNode(
                id="transform",
                type="utility.transform",
                position=Position(x=200, y=0),
                config={"value": "{{ missing.value }}"},
                pinnedData={"success": {"source": "fixed"}},
            ),
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
    assert [event.type for event in events if event.node_id == "transform"] == [
        "node_started",
        "node_pinned_data_used",
        "node_succeeded",
    ]
    succeeded = next(event for event in events if event.node_id == "transform" and event.type == "node_succeeded")
    assert succeeded.payload["outputs"] == {"success": {"source": "fixed"}}
    assert succeeded.payload["pinned"] is True


@pytest.mark.asyncio
async def test_production_execution_context_ignores_pinned_node_output():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_pinned_output_production",
        name="Pinned output production",
        nodes=[
            WorkflowNode(id="start", type="manual.trigger", position=Position(x=0, y=0), config={"payload": {}}),
            WorkflowNode(
                id="transform",
                type="utility.transform",
                position=Position(x=200, y=0),
                config={"value": "{{ missing.value }}"},
                pinnedData={"success": {"source": "fixed"}},
            ),
        ],
        edges=[
            WorkflowEdge(id="e1", source="start", sourceHandle="success", target="transform", targetHandle="input"),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(
        run.id,
        saved,
        execution_context=ExecutionContext(deadline=time.monotonic() + 10, allow_pinned_data=False),
    )

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "failed"
    assert not any(event.node_id == "transform" and event.type == "node_pinned_data_used" for event in events)


@pytest.mark.asyncio
async def test_non_manual_entry_execution_does_not_seed_pinned_upstream_input():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_non_manual_pinned_input",
        name="Non-manual pinned input",
        nodes=[
            WorkflowNode(
                id="source",
                type="manual.trigger",
                position=Position(x=0, y=0),
                config={"payload": {"status_code": 503}},
                pinnedData={"success": {"status_code": 200}},
            ),
            WorkflowNode(
                id="assert_status",
                type="assert.status_code",
                position=Position(x=200, y=0),
                config={"expected": 200},
            ),
        ],
        edges=[
            WorkflowEdge(
                id="source_assert",
                source="source",
                sourceHandle="success",
                target="assert_status",
                targetHandle="input",
            )
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(
        run.id,
        saved,
        entry_node_id="assert_status",
        execution_context=ExecutionContext(deadline=time.monotonic() + 10, allow_pinned_data=False),
    )

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "failed"
    assert not any(event.type == "node_pinned_input_used" for event in events)


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
async def test_executor_injects_credential_headers_without_exposing_secret_in_events(
    monkeypatch: pytest.MonkeyPatch,
):
    captured_headers: dict[str, str] = {}

    async def capture_request(self, method, url, *, headers, json):
        captured_headers.update(headers)
        return httpx.Response(200, json={"echo": "very-secret-token"})

    monkeypatch.setattr(httpx.AsyncClient, "request", capture_request)
    storage = Storage(":memory:")
    storage.init_schema()
    credential = storage.create_credential(
        type_id="http.bearer",
        name="测试令牌",
        encrypted_data=CredentialVault().encrypt({"token": "very-secret-token"}),
    )
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_http_credential",
        name="HTTP credential",
        nodes=[
            WorkflowNode(
                id="start",
                type="manual.trigger",
                position=Position(x=0, y=0),
                config={"payload": {"Authorization": "input-value", "X-Input": "yes"}},
            ),
            WorkflowNode(
                id="http",
                type="http.request",
                position=Position(x=200, y=0),
                config={
                    "url": "https://example.test/api",
                    "credential_id": credential.id,
                    "headers": {"Authorization": "config-value", "X-Config": "yes"},
                },
            ),
        ],
        edges=[
            WorkflowEdge(
                id="headers",
                source="start",
                sourceHandle="success",
                target="http",
                targetHandle="headers",
            )
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    serialized_events = " ".join(str(event.payload) for event in events)
    assert storage.get_run(run.id).status == "succeeded"
    assert captured_headers == {
        "Authorization": "input-value",
        "X-Config": "yes",
        "X-Input": "yes",
    }
    assert "very-secret-token" not in serialized_events


@pytest.mark.asyncio
async def test_executor_resolves_an_environment_credential_override_from_the_run_snapshot(
    monkeypatch: pytest.MonkeyPatch,
):
    captured_headers: dict[str, str] = {}

    async def capture_request(self, method, url, *, headers, json):
        captured_headers.update(headers)
        return httpx.Response(200, json={"ok": True})

    monkeypatch.setattr(httpx.AsyncClient, "request", capture_request)
    storage = Storage(":memory:")
    storage.init_schema()
    default_credential = storage.create_credential(
        type_id="http.bearer",
        name="默认令牌",
        encrypted_data=CredentialVault().encrypt({"token": "default-token"}),
    )
    staging_credential = storage.create_credential(
        type_id="http.bearer",
        name="测试令牌",
        encrypted_data=CredentialVault().encrypt({"token": "staging-token"}),
    )
    staging = storage.create_project_environment(
        name="测试环境",
        variables={},
        credential_overrides={default_credential.id: staging_credential.id},
    )
    workflow = WorkflowDocument(
        id="wf_environment_credential",
        name="Environment credential",
        settings={"environment_id": staging.id},
        nodes=[
            WorkflowNode(
                id="request",
                type="http.request",
                position=Position(x=0, y=0),
                config={"url": "https://example.test/api", "credential_id": default_credential.id},
            )
        ],
        edges=[],
    )
    saved = storage.save_workflow(workflow, publish=False)
    run = storage.create_run(saved, invocation=RunInvocation(environment_id=staging.id))
    storage.update_project_environment(staging.id, credential_overrides={default_credential.id: default_credential.id})
    executor = WorkflowExecutor(storage=storage, registry=make_registry())

    await executor.execute(run.id, saved)

    assert storage.get_run(run.id).status == "succeeded"
    assert captured_headers["Authorization"] == "Bearer staging-token"
    assert storage.get_run_invocation(run.id).credential_overrides == {default_credential.id: staging_credential.id}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("type_id", "data", "expected_headers", "secret"),
    [
        (
            "http.basic",
            {"username": "api-user", "password": "api-password"},
            {"Authorization": "Basic YXBpLXVzZXI6YXBpLXBhc3N3b3Jk"},
            "api-password",
        ),
        (
            "http.header",
            {"name": "X-API-Key", "value": "header-secret"},
            {"X-API-Key": "header-secret"},
            "header-secret",
        ),
    ],
)
async def test_executor_injects_all_supported_local_http_credential_types(
    monkeypatch: pytest.MonkeyPatch,
    type_id: str,
    data: dict[str, str],
    expected_headers: dict[str, str],
    secret: str,
):
    captured_headers: dict[str, str] = {}

    async def capture_request(self, method, url, *, headers, json):
        captured_headers.update(headers)
        return httpx.Response(200, json={"echo": secret})

    monkeypatch.setattr(httpx.AsyncClient, "request", capture_request)
    storage = Storage(":memory:")
    storage.init_schema()
    credential = storage.create_credential(
        type_id=type_id,
        name=f"{type_id} credential",
        encrypted_data=CredentialVault().encrypt(data),
    )
    workflow = WorkflowDocument(
        id=f"wf_{type_id}",
        name="HTTP credential types",
        nodes=[
            WorkflowNode(
                id="http",
                type="http.request",
                position=Position(x=0, y=0),
                config={"url": "https://example.test/api", "credential_id": credential.id},
            )
        ],
        edges=[],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)

    await WorkflowExecutor(storage=storage, registry=make_registry()).execute(run.id, saved)

    serialized_events = " ".join(str(event.payload) for event in storage.list_events(run.id))
    assert storage.get_run(run.id).status == "succeeded"
    assert captured_headers == expected_headers
    assert secret not in serialized_events


@pytest.mark.asyncio
async def test_executor_does_not_retain_credential_secrets_after_a_run(
    monkeypatch: pytest.MonkeyPatch,
):
    async def echo_secret(self, method, url, *, headers, json):
        return httpx.Response(200, json={"echo": "first-run-secret"})

    monkeypatch.setattr(httpx.AsyncClient, "request", echo_secret)
    storage = Storage(":memory:")
    storage.init_schema()
    credential = storage.create_credential(
        type_id="http.bearer",
        name="First run credential",
        encrypted_data=CredentialVault().encrypt({"token": "first-run-secret"}),
    )
    first_workflow = storage.save_workflow(
        WorkflowDocument(
            id="wf_first_credential_run",
            name="First credential run",
            nodes=[
                WorkflowNode(
                    id="http",
                    type="http.request",
                    position=Position(x=0, y=0),
                    config={"url": "https://example.test/first", "credential_id": credential.id},
                )
            ],
            edges=[],
        )
    )
    second_workflow = storage.save_workflow(
        WorkflowDocument(
            id="wf_second_plain_run",
            name="Second plain run",
            nodes=[
                WorkflowNode(
                    id="http",
                    type="http.request",
                    position=Position(x=0, y=0),
                    config={"url": "https://example.test/second"},
                )
            ],
            edges=[],
        )
    )
    first_run = storage.create_run(first_workflow)
    second_run = storage.create_run(second_workflow)
    executor = WorkflowExecutor(storage=storage, registry=make_registry())

    await executor.execute(first_run.id, first_workflow)
    await executor.execute(second_run.id, second_workflow)

    first_run_events = str([event.payload for event in storage.list_events(first_run.id)])
    second_run_events = str([event.payload for event in storage.list_events(second_run.id)])
    assert "first-run-secret" not in first_run_events
    assert "first-run-secret" in second_run_events


@pytest.mark.asyncio
async def test_concurrent_root_runs_keep_credential_redaction_isolated(
    monkeypatch: pytest.MonkeyPatch,
):
    entered_tokens: set[str] = set()
    release_responses = asyncio.Event()

    async def echo_other_secret(self, method, url, *, headers, json):
        token = headers["Authorization"].removeprefix("Bearer ")
        entered_tokens.add(token)
        if len(entered_tokens) == 2:
            release_responses.set()
        await release_responses.wait()
        other_secret = "second-concurrent-secret" if token == "first-concurrent-secret" else "first-concurrent-secret"
        return httpx.Response(200, json={"echo": other_secret})

    monkeypatch.setattr(httpx.AsyncClient, "request", echo_other_secret)
    storage = Storage(":memory:")
    storage.init_schema()
    first_credential = storage.create_credential(
        type_id="http.bearer",
        name="First concurrent credential",
        encrypted_data=CredentialVault().encrypt({"token": "first-concurrent-secret"}),
    )
    second_credential = storage.create_credential(
        type_id="http.bearer",
        name="Second concurrent credential",
        encrypted_data=CredentialVault().encrypt({"token": "second-concurrent-secret"}),
    )

    def workflow(workflow_id: str, credential_id: str) -> WorkflowDocument:
        return storage.save_workflow(
            WorkflowDocument(
                id=workflow_id,
                name=workflow_id,
                nodes=[
                    WorkflowNode(
                        id="http",
                        type="http.request",
                        position=Position(x=0, y=0),
                        config={"url": f"https://example.test/{workflow_id}", "credential_id": credential_id},
                    )
                ],
                edges=[],
            )
        )

    first_workflow = workflow("wf_first_concurrent", first_credential.id)
    second_workflow = workflow("wf_second_concurrent", second_credential.id)
    first_run = storage.create_run(first_workflow)
    second_run = storage.create_run(second_workflow)
    executor = WorkflowExecutor(storage=storage, registry=make_registry())

    await asyncio.gather(
        executor.execute(first_run.id, first_workflow),
        executor.execute(second_run.id, second_workflow),
    )

    first_events = str([event.payload for event in storage.list_events(first_run.id)])
    second_events = str([event.payload for event in storage.list_events(second_run.id)])
    assert "first-concurrent-secret" not in first_events
    assert "second-concurrent-secret" not in second_events
    assert "second-concurrent-secret" in first_events
    assert "first-concurrent-secret" in second_events

@pytest.mark.asyncio
async def test_executor_records_a_missing_local_credential_as_a_node_failure():
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_missing_local_credential",
        name="Missing credential",
        nodes=[
            WorkflowNode(
                id="http",
                type="http.request",
                position=Position(x=0, y=0),
                config={"url": "https://example.test/api", "credential_id": "cred_deleted"},
            )
        ],
        edges=[],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=registry)

    await executor.execute(run.id, saved)

    failed = next(event for event in storage.list_events(run.id) if event.type == "node_failed")
    assert storage.get_run(run.id).status == "failed"
    assert failed.payload["error"]["message"] == "引用的凭据不存在或已删除。"


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
