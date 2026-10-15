import asyncio
import base64
import json
import os
from pathlib import Path

from fastapi.testclient import TestClient
import httpx
import pytest

from apps.api.nodeflow_api.main import create_app


def test_example_configuration_preserves_custom_legacy_grouping_as_common_fields():
    from copy import deepcopy
    from examples.a3_purchase.configure import bind_workflow

    template = json.loads(Path("examples/a3_purchase/workflow.json").read_text(encoding="utf-8"))
    previous = deepcopy(template)
    next(node for node in previous["nodes"] if node["id"] == "tasks")["config"] = {"group_by": ["源单单号", "仓库ID"]}
    profile = json.loads(Path("examples/a3_purchase/profile.example.json").read_text(encoding="utf-8"))
    result = bind_workflow(template, previous, profile, "offline-profile")
    config = next(node for node in result["nodes"] if node["id"] == "tasks")["config"]
    assert "by" not in config
    assert {field["name"] for field in config["common_fields"] if field["on_difference"] == "split"} == {"order_code", "warehouse_id"}
    assert next(field for field in config["common_fields"] if field["name"] == "warehouse_id")["emit"] is False
    assert result["settings"]["run_mode"] == "preview" and result["active"] is False
    assert "warehouse_id" not in {field["name"] for field in next(node for node in template["nodes"] if node["id"] == "tasks")["config"]["common_fields"]}


def test_options_migration_preserves_custom_values_and_rejects_dynamic_logic():
    from copy import deepcopy
    from examples.a3_purchase.migrate_bindings import migrate
    original = {"id": "custom", "name": "Custom", "nodes": [
        {"id": "options", "type": "data.compose", "config": {"fields": [{"name": "default_warehouse", "expression": "{'id': 'custom', 'name': '自定义仓库'}"}]}},
        {"id": "prepare", "type": "data.records_prepare", "config": {"columns": []}},
    ], "edges": [{"source": "options", "target": "prepare", "targetHandle": "options"}], "settings": {"run_mode": "live"}, "active": True}
    before = deepcopy(original)
    result = migrate(original)
    assert original == before
    assert [node["id"] for node in result["nodes"]] == ["prepare"]
    assert result["edges"] == []
    assert result["settings"]["configuration"][0]["default"] == {"id": "custom", "name": "自定义仓库"}
    assert result["nodes"][0]["configBindings"]["options.default_warehouse"] == {"source": "workflow", "key": "default_warehouse"}
    assert result["settings"]["run_mode"] == "preview" and result["active"] is False
    assert migrate(result) == result
    original["nodes"][0]["config"]["fields"][0]["expression"] = "inputs.input.warehouse"
    with pytest.raises(ValueError):
        migrate(original)


@pytest.mark.parametrize("mode", ["preview", "live"])
def test_generic_a3_workflow_uses_http_only_with_mock_transport(tmp_path, monkeypatch, mode):
    monkeypatch.setenv("NODE_FLOW_CREDENTIAL_KEY", base64.b64encode(os.urandom(32)).decode())
    app = create_app(database_path=tmp_path / "offline.sqlite3", execution_mode="worker")
    client = TestClient(app)
    account = client.post("/api/credentials", json={"name": "offline", "type_id": "http.login", "data": {"tenant": "offline", "username": "offline", "password": "secret-offline"}})
    assert account.status_code == 201, account.text
    profile = json.loads(Path("examples/a3_purchase/http-profile.example.json").read_text(encoding="utf-8"))
    profile["credential_id"] = account.json()["id"]
    response = client.post("/api/http-profiles", json=profile)
    assert response.status_code == 201, response.text
    workflow = json.loads(Path("examples/a3_purchase/workflow.json").read_text(encoding="utf-8").replace("http_profile_REPLACE_WITH_YOUR_HTTP_PROFILE_ID", response.json()["id"]))
    workflow["settings"]["run_mode"] = mode
    result = client.post("/api/workflows", json=workflow)
    assert result.status_code == 200, result.text
    calls = []
    record = json.loads(Path("tests/fixtures/a3_purchase/purchase_order_line.json").read_text(encoding="utf-8"))
    def handle(request):
        calls.append(request.url.path)
        if request.url.path.endswith("/login"):
            return httpx.Response(200, json={"code": "200", "data": {"access_token": "secret-token", "token_uuid": "secret-uuid"}})
        assert request.headers["access_token"] == "secret-token"
        if request.url.path.endswith("defaultPage"):
            return httpx.Response(200, json={"success": True, "code": "200", "data": {"records": [record]}})
        assert request.url.path.endswith("defaultSaveOrUpdate")
        return httpx.Response(200, json={"success": True, "code": "200", "data": "offline-id"})
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(**kwargs, transport=httpx.MockTransport(handle)))
    run = client.post(f"/api/workflows/{workflow['id']}/runs", json={})
    assert run.status_code == 200, run.text
    asyncio.run(app.state.executor.execute(run.json()["id"], app.state.storage.get_workflow(workflow["id"])))
    events = app.state.storage.list_events(run.json()["id"])
    assert app.state.storage.get_run(run.json()["id"]).status == "succeeded", [(event.type, event.node_id, event.payload) for event in events if "fail" in event.type]
    assert sum(path.endswith("/login") for path in calls) == 1
    assert any(path.endswith("defaultPage") for path in calls)
    assert any(path.endswith("defaultSaveOrUpdate") for path in calls) == (mode == "live")
    if mode == "preview":
        assert all(event.payload.get("outputs") == {} for event in events if event.node_id == "save" and event.type == "node_succeeded")
    serialized = json.dumps([event.model_dump() for event in events])
    for secret in ("secret-offline", "secret-token", "secret-uuid"):
        assert secret not in serialized
    if mode == "preview":
        plan = next(event for event in events if event.node_id == "save" and event.type == "node_previewed")
        assert plan.payload["complete"] is False
        assert plan.payload["effects"][0]["details"]["body"]["details"]


def test_template_catalog_exposes_presets_and_subflows_without_executing(tmp_path):
    app = create_app(database_path=tmp_path / "catalog.sqlite3", execution_mode="worker")
    response = TestClient(app).get("/api/node-templates")
    assert response.status_code == 200, response.text
    assert {asset["kind"] for asset in response.json()} == {"node", "subflow", "workflow"}
    assert len(response.json()) == 8


def test_template_package_loads_without_the_legacy_connector(tmp_path):
    import shutil
    from apps.api.nodeflow_api.node_registry import NodeRegistry
    from apps.api.nodeflow_api.node_templates import list_templates
    for package in ("builtin", "a3_purchase"):
        shutil.copytree(Path("nodes") / package, tmp_path / package, ignore=shutil.ignore_patterns("__pycache__"))
    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()
    assert all(package.status == "loaded" for package in registry.list_packages())
    assert not any(node.id.startswith("a3.") for node in registry.list_node_types())
    assert len(list_templates(registry)) == 8
