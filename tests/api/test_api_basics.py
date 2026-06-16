import importlib
from pathlib import Path

from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app


def test_health_check():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_node_types_endpoint_lists_builtin_nodes():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    response = client.get("/api/node-types")
    assert response.status_code == 200
    payload = response.json()
    ids = {node["id"] for node in payload}
    assert "manual.trigger" in ids
    assert "http.request" in ids


def test_workflow_endpoints_save_get_and_list_workflows():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    workflow = {
        "id": "workflow_1",
        "name": "Demo Workflow",
        "nodes": [
            {
                "id": "node_1",
                "type": "manual.trigger",
                "position": {"x": 10, "y": 20},
                "config": {"payload": {"label": "Start"}},
            }
        ],
        "edges": [],
    }

    save_response = client.post("/api/workflows", json=workflow)
    get_response = client.get("/api/workflows/workflow_1")
    list_response = client.get("/api/workflows")

    assert save_response.status_code == 200
    assert save_response.json()["version"] == 1
    assert get_response.status_code == 200
    assert get_response.json()["id"] == "workflow_1"
    assert get_response.json()["version"] == 1
    assert list_response.status_code == 200
    assert list_response.json() == [{"id": "workflow_1", "name": "Demo Workflow", "version": 1}]


def test_missing_workflow_returns_404():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))

    response = client.get("/api/workflows/missing")

    assert response.status_code == 404
    assert response.json() == {"detail": "Workflow not found"}


def test_importing_main_does_not_create_default_database(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    import apps.api.nodeflow_api.main as main_module

    importlib.reload(main_module)

    assert not (tmp_path / "node-flow.sqlite3").exists()
