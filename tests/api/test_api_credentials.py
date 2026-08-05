from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app


def _client() -> TestClient:
    return TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))


def _create_bearer_credential(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/api/credentials",
        json={
            "type_id": "http.bearer",
            "name": "测试接口令牌",
            "data": {"token": "very-secret-token"},
        },
    )
    assert response.status_code == 201
    assert "very-secret-token" not in response.text
    return response.json()


def test_credential_api_lists_types_and_never_returns_secret_values():
    client = _client()

    types_response = client.get("/api/credential-types")
    created = _create_bearer_credential(client)
    listed = client.get("/api/credentials")
    updated = client.patch(
        f"/api/credentials/{created['id']}",
        json={"name": "已更新令牌", "data": {"token": "replacement-secret"}},
    )

    assert types_response.status_code == 200
    assert [item["id"] for item in types_response.json()] == [
        "http.bearer",
        "http.basic",
        "http.header",
        "webhook.hmac_sha256",
    ]
    assert created["type_id"] == "http.bearer"
    assert created["name"] == "测试接口令牌"
    assert "data" not in created
    assert listed.status_code == 200
    assert "very-secret-token" not in listed.text
    assert updated.status_code == 200
    assert updated.json()["name"] == "已更新令牌"
    assert "replacement-secret" not in updated.text


def test_credential_api_rejects_deletion_while_a_workflow_references_it():
    client = _client()
    credential = _create_bearer_credential(client)
    workflow = {
        "id": "wf_credential_reference",
        "name": "凭据引用工作流",
        "active": False,
        "nodes": [
            {
                "id": "request",
                "type": "http.request",
                "label": "受保护请求",
                "position": {"x": 0, "y": 0},
                "config": {
                    "url": "https://example.test/api",
                    "credential_id": credential["id"],
                },
            }
        ],
        "edges": [],
    }

    assert client.post("/api/workflows", json=workflow).status_code == 200
    references = client.get(f"/api/credentials/{credential['id']}/references")
    delete_response = client.delete(f"/api/credentials/{credential['id']}")

    assert references.status_code == 200
    assert references.json() == [
        {
            "workflow_id": "wf_credential_reference",
            "workflow_name": "凭据引用工作流",
            "node_id": "request",
            "node_label": "受保护请求",
        }
    ]
    assert delete_response.status_code == 409
    assert delete_response.json()["detail"]["code"] == "credential_in_use"


def test_workflow_validation_reports_missing_credential_before_running():
    client = _client()
    workflow = {
        "id": "wf_missing_credential",
        "name": "缺失凭据",
        "active": False,
        "nodes": [
            {
                "id": "request",
                "type": "http.request",
                "position": {"x": 0, "y": 0},
                "config": {"url": "https://example.test/api", "credential_id": "cred_missing"},
            }
        ],
        "edges": [],
    }

    response = client.post("/api/workflows", json=workflow)

    assert response.status_code == 422
    assert response.json()["detail"] == [
        {
            "path": "nodes.request.config.credential_id",
            "message": "引用的凭据不存在或已删除。",
            "code": "credential_not_found",
        }
    ]


def test_credential_reference_protection_ignores_unrelated_config_values():
    client = _client()
    credential = _create_bearer_credential(client)
    workflow = {
        "id": "wf_credential_text_value",
        "name": "Credential-looking text",
        "active": False,
        "nodes": [
            {
                "id": "log",
                "type": "utility.log",
                "position": {"x": 0, "y": 0},
                "config": {"message": credential["id"]},
            }
        ],
        "edges": [],
    }

    assert client.post("/api/workflows", json=workflow).status_code == 200
    assert client.get(f"/api/credentials/{credential['id']}/references").json() == []
    assert client.delete(f"/api/credentials/{credential['id']}").status_code == 204
