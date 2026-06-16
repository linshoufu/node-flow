from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app


def test_health_check():
    client = TestClient(create_app(database_path=":memory:"))
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_node_types_endpoint_lists_builtin_nodes():
    client = TestClient(create_app(database_path=":memory:"))
    response = client.get("/api/node-types")
    assert response.status_code == 200
    payload = response.json()
    ids = {node["id"] for node in payload}
    assert "manual.trigger" in ids
    assert "http.request" in ids
