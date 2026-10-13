from fastapi.testclient import TestClient

from apps.api.nodeflow_api.http_profiles import resolve_http_request_config
from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.schemas import HttpProfile


def test_http_profile_resource_can_be_created_and_listed(tmp_path):
    client = TestClient(create_app(database_path=tmp_path / "node-flow.sqlite3", nodes_dir=tmp_path))

    response = client.post(
        "/api/http-profiles",
        json={
            "name": "Test API",
            "base_url": "https://api.example.com/",
            "headers": {"Accept": "application/json"},
            "timeout_seconds": 15,
            "authentication": {
                "mode": "login",
                "login": {"method": "POST", "path": "/sessions"},
            },
        },
    )

    assert response.status_code == 201
    profile = response.json()
    assert profile["base_url"] == "https://api.example.com"
    assert profile["authentication"]["mode"] == "login"
    assert client.get("/api/http-profiles").json()[0]["id"] == profile["id"]


def test_http_profile_defaults_leave_node_overrides_in_control():
    profile = HttpProfile(
        id="http_test",
        name="Test API",
        base_url="https://api.example.com/v1",
        headers={"Accept": "application/json", "X-Client": "node-flow"},
        credential_id="cred_profile",
        timeout_seconds=15,
        authentication={"mode": "login", "login": {"path": "/sessions"}},
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    config = resolve_http_request_config(
        {
            "http_profile_id": profile.id,
            "url": "/users",
            "headers": {"X-Client": "workflow"},
            "timeout_seconds": 5,
        },
        profile,
    )

    assert config == {
        "url": "https://api.example.com/v1/users",
        "headers": {"Accept": "application/json", "X-Client": "workflow"},
        "credential_id": "cred_profile",
        "timeout_seconds": 5,
        "authentication": {"mode": "login", "login": {"path": "/sessions"}},
    }
