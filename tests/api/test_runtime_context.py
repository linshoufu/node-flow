import json
from pathlib import Path
from textwrap import dedent

import httpx
import pytest

from apps.api.nodeflow_api.executor import WorkflowExecutor
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowEdge, WorkflowNode
from apps.api.nodeflow_api.storage import Storage


def make_registry(nodes_dir: Path | None = None) -> NodeRegistry:
    registry = NodeRegistry(nodes_dir=nodes_dir or Path("nodes"))
    registry.scan()
    return registry


def position(x: int = 0, y: int = 0) -> Position:
    return Position(x=x, y=y)


@pytest.mark.asyncio
async def test_executor_resolves_env_and_secret_templates_without_logging_secret(
    monkeypatch: pytest.MonkeyPatch,
):
    seen_requests: list[dict] = []

    async def fake_request(self, method, url, *, headers, json):
        seen_requests.append({"method": method, "url": url, "headers": headers, "json": json})
        request = httpx.Request(method, url)
        return httpx.Response(200, json={"ok": True}, request=request)

    monkeypatch.setattr(httpx.AsyncClient, "request", fake_request)
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry()
    workflow = WorkflowDocument(
        id="wf_runtime_context",
        name="Runtime Context",
        nodes=[
            WorkflowNode(
                id="start",
                type="manual.trigger",
                position=position(),
                config={"payload": {"name": "Ada"}},
            ),
            WorkflowNode(
                id="headers",
                type="utility.transform",
                position=position(0, 180),
                config={
                    "value": {
                        "Authorization": "Bearer {{ secrets.api_token }}",
                        "X-Target": "{{ env.target }}",
                    }
                },
            ),
            WorkflowNode(
                id="request",
                type="http.request",
                position=position(240, 0),
                config={"method": "POST", "url": "{{ env.base_url }}/users"},
            ),
        ],
        edges=[
            WorkflowEdge(
                id="e1",
                source="start",
                sourceHandle="success",
                target="request",
                targetHandle="body",
            ),
            WorkflowEdge(
                id="e2",
                source="headers",
                sourceHandle="success",
                target="request",
                targetHandle="headers",
            ),
        ],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(
        storage=storage,
        registry=registry,
        environment={"base_url": "https://api.test", "target": "staging"},
        secrets={"api_token": "s3cr3t-token"},
    )

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    assert seen_requests == [
        {
            "method": "POST",
            "url": "https://api.test/users",
            "headers": {"Authorization": "Bearer s3cr3t-token", "X-Target": "staging"},
            "json": {"name": "Ada"},
        }
    ]
    assert "s3cr3t-token" not in json.dumps([event.model_dump() for event in events])
    assert "Bearer ***" in json.dumps([event.model_dump() for event in events])


@pytest.mark.asyncio
async def test_node_context_can_read_secret_without_leaking_event_payload(tmp_path: Path):
    (tmp_path / "secret_probe.py").write_text(
        dedent(
            """
            from nodeflow_sdk import BaseNode, NodeConfig, NodeContext, Output, node


            @node(id="test.secret_probe", name="Secret Probe", category="Test")
            class SecretProbeNode(BaseNode[NodeConfig]):
                outputs = {"success": Output(description="Secret value")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    return {"success": ctx.get_secret("api_token")}
            """
        ),
        encoding="utf-8",
    )
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry(tmp_path)
    workflow = WorkflowDocument(
        id="wf_secret_context",
        name="Secret Context",
        nodes=[
            WorkflowNode(
                id="probe",
                type="test.secret_probe",
                position=position(),
                config={},
            ),
        ],
        edges=[],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(
        storage=storage,
        registry=registry,
        secrets={"api_token": "node-secret-value"},
    )

    await executor.execute(run.id, saved)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    serialized_events = json.dumps([event.model_dump() for event in events])
    assert "node-secret-value" not in serialized_events
    assert '"success": "***"' in serialized_events


@pytest.mark.asyncio
async def test_failed_run_error_does_not_store_raw_secret(tmp_path: Path):
    (tmp_path / "secret_fail.py").write_text(
        dedent(
            """
            from nodeflow_sdk import BaseNode, NodeConfig, NodeContext, Output, node


            @node(id="test.secret_fail", name="Secret Fail", category="Test")
            class SecretFailNode(BaseNode[NodeConfig]):
                outputs = {"success": Output(description="Unreachable")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    raise RuntimeError(f"failed with {ctx.get_secret('api_token')}")
            """
        ),
        encoding="utf-8",
    )
    storage = Storage(":memory:")
    storage.init_schema()
    registry = make_registry(tmp_path)
    workflow = WorkflowDocument(
        id="wf_secret_failure",
        name="Secret Failure",
        nodes=[
            WorkflowNode(
                id="fail",
                type="test.secret_fail",
                position=position(),
                config={},
            ),
        ],
        edges=[],
    )
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(
        storage=storage,
        registry=registry,
        secrets={"api_token": "failure-secret"},
    )

    await executor.execute(run.id, saved)

    stored_run = storage.get_run(run.id)
    events = storage.list_events(run.id)
    assert stored_run.status == "failed"
    assert stored_run.error == "failed with ***"
    assert "failure-secret" not in json.dumps([event.model_dump() for event in events])
