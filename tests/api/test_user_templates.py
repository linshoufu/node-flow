from copy import deepcopy
import json
from pathlib import Path

from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.storage import Storage


def preset():
    return {"name": "My HTTP preset", "kind": "node", "node": {"id": "request", "type": "http.request", "position": {"x": 0, "y": 0}, "config": {"url": "https://example.invalid/test", "method": "POST", "operation": "write"}, "pinnedData": {"response": {"token": "runtime-secret"}}}}


def test_user_preset_persists_without_changing_package_resources_or_creating_runs(tmp_path):
    path = tmp_path / "library.sqlite3"
    app = create_app(database_path=path, execution_mode="worker")
    client = TestClient(app)
    packages = [item for item in client.get("/api/node-templates").json() if item["source"] == "package"]
    request = preset()
    before = deepcopy(request)
    response = client.post("/api/node-templates", json=request)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["source"] == "user"
    assert saved["id"].startswith("user_")
    assert "pinnedData" not in saved["node"]
    assert request == before
    catalog = client.get("/api/node-templates").json()
    assert catalog[0] == saved
    assert [item for item in catalog if item["source"] == "package"] == packages
    assert app.state.storage.list_workflows() == []
    storage = Storage(path)
    storage.init_schema()
    assert storage.list_user_templates() == [saved]
    assert storage._connection.execute("SELECT count(*) FROM runs").fetchone()[0] == 0
    storage.close()


def test_workflow_template_retains_graph_and_forces_preview_without_runtime_data(tmp_path):
    client = TestClient(create_app(database_path=tmp_path / "library.sqlite3", execution_mode="worker"))
    node = preset()["node"]
    response = client.post("/api/node-templates", json={"kind": "workflow", "name": "My workflow", "workflow": {"id": "original", "name": "Original", "active": True, "version": 8, "settings": {"run_mode": "live", "error_workflow_id": "other"}, "nodes": [node], "edges": []}})
    assert response.status_code == 201, response.text
    workflow = response.json()["workflow"]
    assert workflow["settings"]["run_mode"] == "preview"
    assert workflow["active"] is False and workflow["version"] == 1
    assert "error_workflow_id" not in workflow["settings"]
    assert "pinnedData" not in workflow["nodes"][0]


def test_templates_keep_explicit_config_and_parameter_dependencies(tmp_path):
    client = TestClient(create_app(database_path=tmp_path / "library.sqlite3", execution_mode="worker"))
    request = {"name": "Bound request", "kind": "node", "configuration": [{"name": "endpoint", "type": "string", "default": "https://example.invalid"}], "parameters": [{"name": "verb", "type": "string", "default": "GET"}], "node": {"id": "http", "type": "http.request", "position": {"x": 0, "y": 0}, "config": {}, "configBindings": {"url": {"source": "workflow", "key": "endpoint"}, "method": {"source": "parameter", "key": "verb"}}}}
    response = client.post("/api/node-templates", json=request)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["node"]["configBindings"] == request["node"]["configBindings"]
    assert saved["configuration"][0]["name"] == "endpoint"
    assert saved["parameters"][0]["name"] == "verb"
    assert saved["node"]["config"] == {}
    request["configuration"] = []
    assert client.post("/api/node-templates", json=request).status_code == 422


def test_invalid_or_sensitive_assets_are_rejected_without_storage(tmp_path):
    app = create_app(database_path=tmp_path / "library.sqlite3", execution_mode="worker")
    client = TestClient(app)
    for change in [{"name": "   "}, {"kind": "subflow"}, {"node": {**preset()["node"], "type": "missing"}}, {"node": {**preset()["node"], "config": {"url": "x", "headers": {"Authorization": "secret-value"}}}}]:
        response = client.post("/api/node-templates", json={**preset(), **change})
        assert response.status_code == 422, response.text
    assert app.state.storage.list_user_templates() == []


def test_user_loop_template_preserves_connections_and_is_a_separate_snapshot(tmp_path):
    client = TestClient(create_app(database_path=tmp_path / "library.sqlite3", execution_mode="worker"))
    source = json.loads(Path("examples/a3_purchase/workflow.json").read_text(encoding="utf-8"))
    graph = next(node for node in source["nodes"] if node["id"] == "each")["subflows"]["body"]
    request = {"name": "My loop", "kind": "subflow", "graph": graph, "configuration": source["settings"]["configuration"]}
    before = deepcopy(request)
    response = client.post("/api/node-templates", json=request)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["graph"]["edges"] == graph["edges"]
    assert len(saved["graph"]["nodes"]) == len(graph["nodes"])
    assert request == before
    assert "workflow" not in saved
