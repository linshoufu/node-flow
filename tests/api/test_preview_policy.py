"""Platform preview uses temporary storage and fake/local effects only."""
import asyncio

from fastapi.testclient import TestClient
import httpx
import pytest

from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.schemas import WorkflowDocument
from apps.api.nodeflow_api.worker import WorkflowWorker
from nodeflow_sdk import NodeContext


def node(name, kind="utility.transform", config=None, **extra):
    return {"id": name, "type": kind, "position": {"x": 0, "y": 0}, "config": config or {}, **extra}


def edge(source, target, output="success", input_name="input"):
    return {"id": f"{source}_{target}", "source": source, "sourceHandle": output,
            "target": target, "targetHandle": input_name}


def workflow(nodes, edges=None, mode="preview", name="preview-test"):
    return WorkflowDocument.model_validate({"id": name, "name": name, "settings": {"run_mode": mode},
                                            "nodes": nodes, "edges": edges or []})


def execute(app, document, invocation=None):
    saved = app.state.storage.save_workflow(document)
    run = app.state.storage.create_run(saved, invocation=invocation)
    asyncio.run(app.state.executor.execute(run.id, saved))
    return app.state.storage.get_run(run.id), app.state.storage.list_events(run.id)


def load_custom(app, tmp_path):
    source = tmp_path / "custom.py"
    source.write_text('''from nodeflow_sdk import BaseNode, NodeConfig, Output, node
@node(id="test.legacy", name="Legacy", category="Test")
class Legacy(BaseNode[NodeConfig]):
    async def execute(self, ctx, inputs):
        return {"success": "legacy executed"}
@node(id="test.state", name="State", category="Test")
class State(BaseNode[NodeConfig]):
    effect = "pure"
    preview_support = "execute"
    async def execute(self, ctx, inputs):
        ctx.set_workflow_static_data("count", ctx.get_workflow_static_data("count", 0) + 1)
        return {"success": ctx.run_mode}
''', encoding="utf-8")
    app.state.registry._load_file(source)


def test_legacy_defaults_stay_live_but_unknown_nodes_block_preview_before_enqueue(tmp_path):
    app = create_app(database_path=":memory:", execution_mode="worker")
    load_custom(app, tmp_path)
    client = TestClient(app)
    legacy = workflow([node("legacy", "test.legacy")], mode="live")
    run, _ = execute(app, legacy)
    assert run.status == "succeeded" and run.run_mode == "live"
    before = len(app.state.storage.list_workflow_runs(legacy.id))
    response = client.post(f"/api/workflows/{legacy.id}/runs", json={"run_mode": "preview"})
    assert response.status_code == 422
    assert "尚不支持" in response.json()["detail"]
    assert len(app.state.storage.list_workflow_runs(legacy.id)) == before


def test_preview_plans_http_without_login_or_network_and_marks_downstream_unverified(monkeypatch):
    async def forbidden(*args, **kwargs):
        raise AssertionError("Preview must not send a request")
    monkeypatch.setattr(httpx.AsyncClient, "request", forbidden)
    app = create_app(database_path=":memory:", execution_mode="worker")
    doc = workflow([node("write", "http.request", {"method": "POST", "url": "https://offline.invalid/orders"}),
                    node("use_id", config={"value": "{{ inputs.input.body.id }}"})], [edge("write", "use_id")])
    run, events = execute(app, doc)
    assert run.status == "succeeded" and run.preview_status == "partial"
    planned = next(event for event in events if event.type == "node_previewed")
    assert planned.payload["outputs"] == {}
    assert planned.payload["effects"][0]["target"] == "https://offline.invalid/orders"
    assert any(event.type == "node_not_verified" and event.node_id == "use_id" for event in events)
    assert not any(event.type == "node_started" and event.node_id == "use_id" for event in events)


def test_http_read_semantics_are_explicit_and_allow_post_queries(monkeypatch):
    calls = []
    async def request(self, method, url, **kwargs):
        calls.append((method, url))
        return httpx.Response(200, json={"found": 2})
    monkeypatch.setattr(httpx.AsyncClient, "request", request)
    app = create_app(database_path=":memory:", execution_mode="worker")
    run, _ = execute(app, workflow([node("read", "http.request", {
        "method": "POST", "url": "https://offline.invalid/query", "operation": "read"})]))
    assert run.status == "succeeded" and run.preview_status == "complete"
    assert len(calls) == 1


def test_report_preview_does_not_create_files_or_directories(tmp_path):
    app = create_app(database_path=":memory:", execution_mode="worker")
    target = tmp_path / "must-not-exist" / "report.json"
    doc = workflow([node("report", "test.write_report", {"path": str(target)})])
    # Direct storage permits testing the node's effect without a large report fixture.
    run, events = execute(app, doc)
    assert run.status == "succeeded"
    assert not target.parent.exists()
    assert any(event.type == "node_previewed" for event in events)


def test_preview_discards_static_state_and_ignores_pinned_outputs(tmp_path):
    app = create_app(database_path=":memory:", execution_mode="worker")
    load_custom(app, tmp_path)
    doc = workflow([node("state", "test.state", pinnedData={"success": "fake"})])
    run, events = execute(app, doc)
    assert run.status == "succeeded"
    assert app.state.storage.get_workflow_static_data(doc.id) == {}
    completed = next(event for event in events if event.type == "node_succeeded")
    assert completed.payload["outputs"] == {"success": "preview"}
    execute(app, doc.model_copy(update={"settings": doc.settings.model_copy(update={"run_mode": "live"})}))
    # Live pinned data preserves the original behavior and never invokes the state node.
    assert app.state.storage.get_workflow_static_data(doc.id) == {}


def test_child_cannot_downgrade_preview_and_parent_propagates_partial_result():
    app = create_app(database_path=":memory:", execution_mode="worker")
    child = workflow([node("trigger", "workflow.trigger"), node("write", "http.request", {"url": "https://offline.invalid"}),
                      node("return", "workflow.return")], [edge("trigger", "write", input_name="body"), edge("write", "return")], mode="live", name="child")
    app.state.storage.save_workflow(child)
    parent = workflow([node("child", "workflow.execute", {"workflow_id": "child"}), node("next")], [edge("child", "next")])
    run, events = execute(app, parent)
    assert run.status == "succeeded" and run.preview_status == "partial"
    child_run = next(item for item in app.state.storage.list_run_tree(run.id) if item.parent_run_id)
    assert child_run.run_mode == "preview" and child_run.preview_status == "partial"
    assert any(event.type == "node_not_verified" and event.node_id == "next" for event in events)


def test_preview_mode_survives_database_reopen_and_worker_claim(tmp_path):
    path = tmp_path / "durable.sqlite3"
    app = create_app(database_path=path, execution_mode="worker")
    doc = app.state.storage.save_workflow(workflow([node("value", config={"value": 42})]))
    run = app.state.storage.create_run(doc)
    # Changing the default after enqueue cannot change the queued run's strategy.
    app.state.storage.save_workflow(doc.model_copy(update={"settings": doc.settings.model_copy(update={"run_mode": "live"})}))
    reopened = create_app(database_path=path, execution_mode="worker")
    worker = WorkflowWorker(storage=reopened.state.storage, executor=reopened.state.executor)
    async def drain():
        claimed = await worker.tick()
        assert len(claimed) == 1 and claimed[0].run_mode == "preview"
        await worker.wait_for_idle()
    asyncio.run(drain())
    assert reopened.state.storage.get_run_invocation(run.id).run_mode == "preview"
    assert reopened.state.storage.get_run(run.id).preview_status == "complete"


def test_sdk_policy_cannot_be_overridden_by_business_inputs():
    ctx = NodeContext(run_id="test", node_id="test", run_mode="preview", data={"run_mode": "live"})
    assert ctx.run_mode == "preview"
    with pytest.raises(AttributeError):
        ctx.run_mode = "live"


def test_planned_write_in_loop_produces_unverified_item_instead_of_a_fake_result():
    app = create_app(database_path=":memory:", execution_mode="worker")
    body = {"nodes": [node("entry", "control.loop_input"),
                      node("write", "http.request", {"method": "POST", "url": "https://offline.invalid"}),
                      node("return", "control.loop_output")],
            "edges": [edge("entry", "write", output="item", input_name="body"), edge("write", "return", input_name="value")]}
    doc = workflow([node("start", config={"value": [{"id": 1}]}),
                    node("each", "control.each_item", subflows={"body": body})], [edge("start", "each", input_name="items")])
    run, events = execute(app, doc)
    assert run.status == "succeeded" and run.preview_status == "partial"
    loop = next(event for event in events if event.node_id == "each" and event.type == "node_succeeded")
    assert loop.payload["outputs"]["results"][0]["status"] == "unverified"
    assert "output" not in loop.payload["outputs"]["results"][0]


def test_preview_retry_keeps_policy_and_does_not_require_external_write_reconciliation():
    app = create_app(database_path=":memory:", execution_mode="worker")
    doc = workflow([node("fail", config={"value": "{{ nodes.missing.outputs.success }}"}),
                    node("write", "test.write_report", {"path": "never-written-report.json"})], [edge("fail", "write")])
    run, _ = execute(app, doc)
    assert run.status == "failed"
    response = TestClient(app).post(f"/api/runs/{run.id}/retry")
    assert response.status_code == 200, response.text
    assert response.json()["run_mode"] == "preview"
