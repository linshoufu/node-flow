import pytest
from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.storage import Storage
from apps.api.nodeflow_api.storage.user_templates import UserTemplateConflict
from tests.api.test_user_templates import preset


def test_personal_resource_lifecycle_keeps_identity_and_uses_revision_guards(tmp_path):
    app = create_app(database_path=tmp_path / "library.sqlite3", execution_mode="worker")
    client = TestClient(app)
    original = client.post("/api/node-templates", json=preset()).json()
    url = f"/api/node-templates/{original['id']}"
    renamed = client.patch(url, json={"name": "Renamed", "description": "New description", "expected_revision": 1})
    assert renamed.status_code == 200, renamed.text
    renamed = renamed.json()
    assert renamed["revision"] == 2
    assert renamed["node"] == original["node"]
    assert renamed["createdAt"] == original["createdAt"]
    assert client.patch(url, json={"name": "Lost edit", "expected_revision": 1}).status_code == 409
    request = preset()
    request["name"] = "Edited"
    request["node"]["config"]["url"] = "https://example.invalid/changed"
    updated = client.put(url, json={**request, "expected_revision": 2})
    assert updated.status_code == 200, updated.text
    updated = updated.json()
    assert updated["id"] == original["id"] and updated["revision"] == 3
    assert updated["node"]["config"]["url"].endswith("/changed")
    assert "pinnedData" not in updated["node"]
    deleted = client.delete(f"{url}?expected_revision=3")
    assert deleted.status_code == 200
    deleted = deleted.json()
    assert deleted["deletedAt"] and deleted["revision"] == 4
    assert all(asset["id"] != original["id"] for asset in client.get("/api/node-templates").json())
    assert any(asset["id"] == original["id"] for asset in client.get("/api/node-templates?include_deleted=true").json())
    assert client.put(url, json={**request, "expected_revision": 4}).status_code == 404
    assert client.post(f"{url}/restore?expected_revision=3").status_code == 409
    restored = client.post(f"{url}/restore?expected_revision=4").json()
    assert restored["deletedAt"] is None and restored["revision"] == 5
    assert restored["node"] == updated["node"]
    assert restored["createdAt"] == original["createdAt"]
    assert app.state.storage.list_workflows() == []
    assert app.state.storage._connection.execute("SELECT count(*) FROM runs").fetchone()[0] == 0


def test_package_resources_reject_every_mutation_and_personal_invalid_updates_are_atomic(tmp_path):
    app = create_app(database_path=tmp_path / "library.sqlite3", execution_mode="worker")
    client = TestClient(app)
    package = client.get("/api/node-templates").json()[0]
    url = f"/api/node-templates/{package['id']}"
    assert client.patch(url, json={"name": "Not allowed", "expected_revision": 1}).status_code == 403
    assert client.put(url, json={**preset(), "expected_revision": 1}).status_code == 403
    assert client.delete(f"{url}?expected_revision=1").status_code == 403
    assert client.post(f"{url}/restore?expected_revision=1").status_code == 403
    personal = client.post("/api/node-templates", json=preset()).json()
    personal_url = f"/api/node-templates/{personal['id']}"
    invalid = preset()
    invalid["node"]["config"]["headers"] = {"Authorization": "sensitive"}
    assert client.put(personal_url, json={**invalid, "expected_revision": 1}).status_code == 422
    assert client.patch(personal_url, json={"name": "  ", "expected_revision": 1}).status_code == 422
    assert app.state.storage.get_user_template(personal["id"]) == personal


def test_revision_check_works_across_storage_connections_and_survives_reopen(tmp_path):
    path = tmp_path / "library.sqlite3"
    first, second = Storage(path), Storage(path)
    first.init_schema()
    second.init_schema()
    original = first.save_user_template({"id": "user_old", "source": "user", "name": "Old", "kind": "node"})
    first.update_user_template(original["id"], 1, {"name": "First edit"})
    with pytest.raises(UserTemplateConflict):
        second.update_user_template(original["id"], 1, {"name": "Second edit"})
    first.close()
    second.close()
    reopened = Storage(path)
    reopened.init_schema()
    assert reopened.get_user_template(original["id"])["name"] == "First edit"
    reopened.close()


def test_workflow_template_updates_keep_preview_and_cannot_change_asset_kind(tmp_path):
    app = create_app(database_path=tmp_path / "library.sqlite3", execution_mode="worker")
    client = TestClient(app)
    document = {"id": "source", "name": "Source", "active": True, "settings": {"run_mode": "live"}, "nodes": [preset()["node"]], "edges": []}
    request = {"name": "Workflow template", "kind": "workflow", "workflow": document}
    created = client.post("/api/node-templates", json=request).json()
    url = f"/api/node-templates/{created['id']}"
    document["nodes"][0]["config"]["url"] = "https://example.invalid/edited"
    updated = client.put(url, json={**request, "expected_revision": 1})
    assert updated.status_code == 200, updated.text
    assert updated.json()["workflow"]["settings"]["run_mode"] == "preview"
    assert updated.json()["workflow"]["active"] is False
    assert client.put(url, json={**preset(), "expected_revision": 2}).status_code == 422
    assert app.state.storage.list_workflows() == []
