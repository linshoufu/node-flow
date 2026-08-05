from __future__ import annotations

import asyncio
import json
from pathlib import Path
from textwrap import dedent

from fastapi.testclient import TestClient

from apps.api.nodeflow_api.credentials import CredentialVault
from apps.api.nodeflow_api.executor import WorkflowExecutor
from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowNode
from apps.api.nodeflow_api.storage import Storage


def write_credential_node_package(nodes_dir: Path) -> None:
    package_dir = nodes_dir / "example"
    package_dir.mkdir(parents=True)
    (package_dir / "nodeflow-package.json").write_text(
        json.dumps(
            {
                "id": "example.credentials",
                "name": "Example Credentials",
                "version": "1.0.0",
                "engines": {
                    "nodeflow": ">=0.1.0,<0.2.0",
                    "python": ">=3.11",
                },
                "pythonDependencies": [],
                "nodeEntrypoints": ["node.py"],
                "credentialTypes": [
                    {
                        "id": "example.api_key",
                        "displayName": "Example API Key",
                        "fields": [{"id": "api_key", "label": "API Key", "secret": True}],
                        "nodeTypeIds": ["example.request"],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (package_dir / "node.py").write_text(
        dedent(
            """
            from nodeflow_sdk import BaseNode, FormField, FormGroup, NodeConfig, NodeContext, NodeForm, Output, node


            class ExampleConfig(NodeConfig):
                auth_credential_id: str | None = None


            @node(
                id="example.request",
                name="Example request",
                category="Test",
                form=NodeForm(groups=(FormGroup("auth", "Authentication", fields=(
                    FormField("auth_credential_id", control="credential", credential_type_ids=("example.api_key",)),
                )),)),
            )
            class ExampleRequestNode(BaseNode[ExampleConfig]):
                outputs = {"success": Output(description="Credential type")}

                async def execute(self, ctx: NodeContext, inputs: dict):
                    credential = ctx.get_credential(self.config.auth_credential_id or "")
                    return {"success": {"credential_type": credential.type_id if credential else None}}
            """
        ).lstrip(),
        encoding="utf-8",
    )


def test_custom_package_credential_type_is_available_through_the_api(tmp_path: Path):
    write_credential_node_package(tmp_path)
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))

    types = client.get("/api/credential-types")
    created = client.post(
        "/api/credentials",
        json={
            "type_id": "example.api_key",
            "name": "Example production",
            "data": {"api_key": "top-secret"},
        },
    )

    assert types.status_code == 200
    assert next(item for item in types.json() if item["id"] == "example.api_key") == {
        "id": "example.api_key",
        "display_name": "Example API Key",
        "fields": [{"id": "api_key", "label": "API Key", "secret": True}],
        "node_type_ids": ["example.request"],
    }
    assert created.status_code == 201
    assert "top-secret" not in created.text

    workflow = {
        "id": "wf_custom_credential_api",
        "name": "Custom credential API",
        "active": False,
        "nodes": [
            {
                "id": "request",
                "type": "example.request",
                "position": {"x": 0, "y": 0},
                "config": {"auth_credential_id": created.json()["id"]},
            }
        ],
        "edges": [],
    }
    saved = client.post("/api/workflows", json=workflow)
    references = client.get(f"/api/credentials/{created.json()['id']}/references")
    delete = client.delete(f"/api/credentials/{created.json()['id']}")

    assert saved.status_code == 200
    assert references.status_code == 200
    assert references.json()[0]["node_id"] == "request"
    assert delete.status_code == 409


def test_custom_package_credential_field_rejects_an_incompatible_type(tmp_path: Path):
    write_credential_node_package(tmp_path)
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))
    wrong_credential = client.post(
        "/api/credentials",
        json={"type_id": "http.bearer", "name": "Wrong type", "data": {"token": "top-secret"}},
    )

    response = client.post(
        "/api/workflows",
        json={
            "id": "wf_wrong_custom_credential",
            "name": "Wrong custom credential",
            "active": False,
            "nodes": [
                {
                    "id": "request",
                    "type": "example.request",
                    "position": {"x": 0, "y": 0},
                    "config": {"auth_credential_id": wrong_credential.json()["id"]},
                }
            ],
            "edges": [],
        },
    )

    assert wrong_credential.status_code == 201
    assert response.status_code == 422
    assert response.json()["detail"] == [
        {
            "path": "nodes.request.config.auth_credential_id",
            "message": "该节点不能使用所选凭据类型。",
            "code": "credential_type_mismatch",
        }
    ]


def test_custom_package_credential_is_validated_and_available_to_its_node(tmp_path: Path):
    write_credential_node_package(tmp_path)
    storage = Storage(":memory:")
    storage.init_schema()
    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()
    credential = storage.create_credential(
        type_id="example.api_key",
        name="Example production",
        encrypted_data=CredentialVault().encrypt({"api_key": "top-secret"}),
    )
    workflow = storage.save_workflow(
        WorkflowDocument(
            id="wf_custom_credential",
            name="Custom credential",
            nodes=[
                WorkflowNode(
                    id="request",
                    type="example.request",
                    position=Position(x=0, y=0),
                    config={"auth_credential_id": credential.id},
                )
            ],
            edges=[],
        )
    )
    run = storage.create_run(workflow)

    asyncio.run(WorkflowExecutor(storage=storage, registry=registry).execute(run.id, workflow))

    event = next(event for event in storage.list_events(run.id) if event.type == "node_succeeded")
    assert event.payload["outputs"]["success"] == {"credential_type": "example.api_key"}
