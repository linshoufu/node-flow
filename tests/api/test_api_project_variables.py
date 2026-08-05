from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app


def _client() -> TestClient:
    return TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))


def test_project_variable_api_manages_non_secret_values():
    client = _client()

    created = client.post("/api/project-variables", json={"name": "base_url", "value": "https://test.example.com"})
    listed = client.get("/api/project-variables")
    updated = client.patch("/api/project-variables/base_url", json={"value": {"region": "staging"}})
    deleted = client.delete("/api/project-variables/base_url")

    assert created.status_code == 201
    assert created.json()["name"] == "base_url"
    assert created.json()["value"] == "https://test.example.com"
    assert listed.status_code == 200
    assert listed.json()[0]["name"] == "base_url"
    assert updated.status_code == 200
    assert updated.json()["value"] == {"region": "staging"}
    assert deleted.status_code == 204
    assert client.get("/api/project-variables").json() == []


def test_project_variable_api_validates_names_and_rejects_duplicates():
    client = _client()

    invalid = client.post("/api/project-variables", json={"name": "base-url", "value": "x"})
    first = client.post("/api/project-variables", json={"name": "base_url", "value": "x"})
    duplicate = client.post("/api/project-variables", json={"name": "base_url", "value": "y"})

    assert invalid.status_code == 422
    assert first.status_code == 201
    assert duplicate.status_code == 409
