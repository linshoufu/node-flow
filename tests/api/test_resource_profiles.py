import asyncio

from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.schemas import RunEvent, RunInvocation, WorkflowDocument
from apps.api.nodeflow_api.storage import utc_now


def create_generic_app(tmp_path):
    # A second connector proves the profile machinery has no A3 dependency.
    (tmp_path / "connector.py").write_text('''
from nodeflow_sdk import BaseNode, NodeConfig, Output, ProfileType, node
class Settings(NodeConfig):
    endpoint: str
class Config(NodeConfig):
    profile_id: str
@node(id="example.connector", name="Example", category="Test")
class Connector(BaseNode[Config]):
    profile_type = ProfileType("example.connection", "Example connection", Settings)
    outputs = {"success": Output(display_name="结果", schema={})}
    async def execute(self, ctx, inputs):
        return {"success": {"endpoint": ctx.profile["data"]["endpoint"]}}
''', encoding="utf-8")
    return create_app(database_path=tmp_path / "test.sqlite3", nodes_dir=tmp_path, execution_mode="worker")


def test_generic_profile_validation_snapshot_execution_and_reference_protection(tmp_path):
    app = create_generic_app(tmp_path)
    client = TestClient(app)
    assert client.get("/api/profile-types").json()[0]["id"] == "example.connection"
    request = {"name": "测试连接", "type_id": "example.connection", "data": {"endpoint": "old"}}
    assert client.post("/api/profiles", json={**request, "data": {}}).status_code == 422
    assert client.post("/api/profiles", json={**request, "data": {"endpoint": "ok", "password": "sensitive"}}).status_code == 422
    profile = client.post("/api/profiles", json=request).json()
    workflow = {"id": "profile-test", "name": "配置档测试", "nodes": [{"id": "example", "type": "example.connector", "position": {"x": 0, "y": 0}, "config": {"profile_id": profile["id"]}}], "edges": []}
    assert client.post("/api/workflows", json=workflow).status_code == 200
    run = client.post("/api/workflows/profile-test/runs").json()
    assert client.put(f"/api/profiles/{profile['id']}", json={**request, "data": {"endpoint": "new"}}).status_code == 200
    asyncio.run(app.state.executor.execute(run["id"], app.state.storage.get_workflow("profile-test")))
    events = app.state.storage.list_events(run["id"])
    assert next(event.payload["outputs"]["success"] for event in events if event.type == "node_succeeded") == {"endpoint": "old"}
    assert client.delete(f"/api/profiles/{profile['id']}").status_code == 409
    app.state.storage.update_run(run["id"], status="failed")
    retried = client.post(f"/api/runs/{run['id']}/retry").json()
    assert app.state.storage.get_run_invocation(retried["id"]).profiles[profile["id"]]["data"] == {"endpoint": "old"}


def test_missing_profile_rejected_before_run_is_queued(tmp_path):
    app = create_generic_app(tmp_path)
    client = TestClient(app)
    workflow = {"id": "missing", "name": "缺失", "nodes": [{"id": "example", "type": "example.connector", "position": {"x": 0, "y": 0}, "config": {"profile_id": "missing"}}], "edges": []}
    assert client.post("/api/workflows", json=workflow).status_code == 200
    assert client.post("/api/workflows/missing/runs").status_code == 422
    assert app.state.storage.list_workflow_runs("missing") == []


def test_workflow_bound_profile_is_snapshotted_and_protected_from_deletion(tmp_path):
    app = create_generic_app(tmp_path)
    client = TestClient(app)
    profile = app.state.storage.save_profile(name="bound", type_id="example.connection", data={"endpoint": "offline"})
    workflow = {"id": "bound-profile", "name": "Bound profile", "settings": {"configuration": [{"name": "connection", "type": "string", "default": profile["id"]}]}, "nodes": [{"id": "example", "type": "example.connector", "position": {"x": 0, "y": 0}, "config": {}, "configBindings": {"profile_id": {"source": "workflow", "key": "connection"}}}], "edges": []}
    saved = client.post("/api/workflows", json=workflow)
    assert saved.status_code == 200, saved.text
    response = client.post("/api/workflows/bound-profile/runs")
    assert response.status_code == 200, response.text
    invocation = app.state.storage.get_run_invocation(response.json()["id"])
    assert invocation.profiles[profile["id"]]["data"] == {"endpoint": "offline"}
    assert client.delete(f"/api/profiles/{profile['id']}").status_code == 409


def test_environment_selects_profile_and_queue_keeps_original_selection(tmp_path):
    app = create_generic_app(tmp_path)
    client = TestClient(app)
    first = app.state.storage.save_profile(name="first", type_id="example.connection", data={"endpoint": "first"})
    second = app.state.storage.save_profile(name="second", type_id="example.connection", data={"endpoint": "second"})
    environment = app.state.storage.create_project_environment(name="test", variables={"connection": first["id"]})
    workflow = {"id": "environment-profile", "name": "环境选择配置档", "settings": {"environment_id": environment.id}, "nodes": [{"id": "example", "type": "example.connector", "position": {"x": 0, "y": 0}, "config": {"profile_id": "{{ project.connection }}"}}], "edges": []}
    assert client.post("/api/workflows", json=workflow).status_code == 200
    run = client.post("/api/workflows/environment-profile/runs").json()
    app.state.storage.update_project_environment(environment.id, variables={"connection": second["id"]})
    asyncio.run(app.state.executor.execute(run["id"], app.state.storage.get_workflow(workflow["id"])))
    assert app.state.storage.get_run(run["id"]).status == "succeeded"
    assert next(event.payload["outputs"]["success"] for event in app.state.storage.list_events(run["id"]) if event.type == "node_succeeded") == {"endpoint": "first"}
    assert client.delete(f"/api/profiles/{second['id']}").status_code == 409


def test_unsafe_connector_rejects_automatic_retry_and_parent_run_replay(tmp_path):
    app = create_generic_app(tmp_path)
    client = TestClient(app)
    app.state.registry.get("example.connector").node_class.retry_safe = False
    profile = app.state.storage.save_profile(name="test", type_id="example.connection", data={"endpoint": "test"})
    workflow = {"id": "unsafe", "name": "不可重试节点", "nodes": [{"id": "write", "type": "example.connector", "position": {"x": 0, "y": 0}, "config": {"profile_id": profile["id"]}, "execution": {"retry": {"maxAttempts": 2}}}], "edges": []}
    assert client.post("/api/workflows", json=workflow).status_code == 422
    workflow["nodes"][0].pop("execution")
    child_workflow = app.state.storage.save_workflow(WorkflowDocument.model_validate(workflow))
    parent_workflow = app.state.storage.save_workflow(WorkflowDocument(id="parent", name="Parent", nodes=[], edges=[]))
    parent = app.state.storage.create_run(parent_workflow)
    child = app.state.storage.create_run(child_workflow, parent_run_id=parent.id, parent_node_id="call", invocation=RunInvocation(execution_mode="child"))
    app.state.storage.append_event(RunEvent(run_id=child.id, type="node_started", node_id="write", timestamp=utc_now()))
    app.state.storage.update_run(child.id, status="failed")
    app.state.storage.update_run(parent.id, status="failed")
    assert client.post(f"/api/runs/{parent.id}/retry").status_code == 409
