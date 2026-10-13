import json
from pathlib import Path
import shutil

from fastapi.testclient import TestClient
import httpx
import pytest

from apps.api.nodeflow_api.main import create_app as create_nodeflow_app
from examples.demo_api import DEMO_PASSWORD, DEMO_USERNAME, create_app
from examples.demo_setup import prepare_demo


def test_demo_requires_login_and_reports_invalid_orders():
    with TestClient(create_app()) as client:
        assert client.get("/health").json()["service"] == "node-flow-demo-api"
        assert client.get("/echo", params={"message": "hello"}).json()["message"] == "hello"
        assert client.get("/products").status_code == 401
        assert client.post("/login", json={"username": DEMO_USERNAME, "password": "wrong"}).status_code == 401

        login = client.post("/login", json={"username": DEMO_USERNAME, "password": DEMO_PASSWORD})
        headers = {"Authorization": login.json()["data"]["authorization"]}
        products = client.get("/products", headers=headers).json()["products"]
        order = {"reference": "first", "product_id": products[0]["id"], "quantity": 2}
        response = client.post("/orders", headers=headers, json=order)
        assert response.status_code == 201
        assert response.json()["order"]["quantity"] == 2
        assert client.post("/orders", headers=headers, json={**order, "quantity": 0}).status_code == 422
        assert client.post("/orders", headers=headers, json={**order, "product_id": "missing"}).status_code == 404

        # Restarting the service resets sessions; generated tokens are not a permanent fixture.
        with TestClient(create_app()) as restarted:
            assert restarted.get("/products", headers=headers).status_code == 401


@pytest.mark.asyncio
async def test_prepared_workflows_run_single_chained_and_mixed_batch(tmp_path, monkeypatch):
    demo_app = create_app()
    original_client = httpx.AsyncClient

    def demo_client(**kwargs):
        return original_client(**kwargs, transport=httpx.ASGITransport(app=demo_app))

    monkeypatch.setattr(httpx, "AsyncClient", demo_client)
    nodes_dir = tmp_path / "nodes"
    shutil.copytree(Path("nodes/builtin"), nodes_dir / "builtin")
    app = create_nodeflow_app(database_path=tmp_path / "workflows.sqlite3", nodes_dir=nodes_dir)
    with TestClient(app) as api:
        output_dir = tmp_path / "demo-workflows"
        prepared = prepare_demo(api, demo_url="http://demo.test", output_dir=output_dir)
        storage = app.state.storage
        executor = app.state.executor
        assert len(prepared) == 3
        for workflow in prepared:
            validated = api.post("/api/workflows/validate", json=workflow)
            assert validated.json()["valid"], validated.json()
            saved = storage.get_workflow(workflow["id"])
            run = storage.create_run(saved)
            await executor.execute(run.id, saved)
            assert storage.get_run(run.id).status == "succeeded"
            events = storage.list_events(run.id)
            if workflow["id"] == "demo_http_single":
                response = next(event for event in events if event.node_id == "echo" and event.type == "node_succeeded")
                assert response.payload["outputs"]["success"]["body"]["message"] == "hello-node-flow"
            if workflow["id"] == "demo_http_chain":
                response = next(event for event in events if event.node_id == "order" and event.type == "node_succeeded")
                assert response.payload["outputs"]["success"]["body"]["order"]["product_id"] == "pencil"
            if workflow["id"] == "demo_http_batch":
                report = json.loads((output_dir / "batch-report.json").read_text(encoding="utf-8"))
                assert report["summary"] == {"total": 4, "passed": 2, "failed": 2}
                assert [result["status"] for result in report["results"]] == ["passed", "failed", "failed", "passed"]
                assert report["results"][-1]["row"]["reference"] == "batch-last"
                assert [result["index"] for result in report["results"]] == [0, 1, 2, 3]
                assert all(result["name"] == "订单提交" for result in report["results"])
            serialized = json.dumps([event.model_dump() for event in events])
            assert DEMO_PASSWORD not in serialized
            assert "Bearer " not in serialized

        # Login exceptions must also produce one failed record per row.
        monkeypatch.setattr("examples.demo_api.DEMO_PASSWORD", "rejected-demo-password")
        batch = storage.get_workflow("demo_http_batch")
        rejected_run = storage.create_run(batch)
        await executor.execute(rejected_run.id, batch)
        assert storage.get_run(rejected_run.id).status == "succeeded"
        rejected_report = json.loads((output_dir / "batch-report.json").read_text(encoding="utf-8"))
        assert rejected_report["summary"] == {"total": 4, "passed": 0, "failed": 4}
        assert rejected_report["results"][-1]["row"]["reference"] == "batch-last"
        assert all(result["actual"]["type"] == "HTTPStatusError" for result in rejected_report["results"])
        assert DEMO_PASSWORD not in json.dumps(rejected_report)

        # Setup is repeatable and preserves edits to existing demo drafts.
        existing = storage.get_workflow("demo_http_single")
        storage.save_workflow(existing.model_copy(update={"name": "My edited example"}), publish=False)
        repeated = prepare_demo(api, demo_url="http://demo.test", output_dir=output_dir)
        assert repeated[0]["name"] == "My edited example"
        assert len(api.get("/api/http-profiles").json()) == 2
        assert len(api.get("/api/credentials").json()) == 1
        assert len(api.get("/api/workflows").json()) == 3
