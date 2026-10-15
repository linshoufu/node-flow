import asyncio
import base64
from importlib.util import find_spec
import json
import os
from pathlib import Path

from fastapi.testclient import TestClient
import httpx
import pytest

from apps.api.nodeflow_api.main import create_app


pytestmark = pytest.mark.skipif(find_spec("a3_tool") is None, reason="Install the optional a3-tool distribution to validate the A3 connector")
EXAMPLES = Path("examples/a3_purchase")


def prepare(tmp_path, monkeypatch, *, mode="preview", bad_row=False, fail_query=False, legacy=False):
    monkeypatch.setenv("NODE_FLOW_CREDENTIAL_KEY", base64.b64encode(os.urandom(32)).decode())
    app = create_app(database_path=tmp_path / "test.sqlite3", execution_mode="worker")
    client = TestClient(app)
    response = client.post("/api/credentials", json={"name": "offline account", "type_id": "a3.account", "data": {"tenancy_code": "offline", "username": "offline-user", "password": "offline-password"}})
    assert response.status_code == 201, response.text
    credential_id = response.json()["id"]
    profile_request = json.loads((EXAMPLES / "profile.example.json").read_text(encoding="utf-8"))
    profile_request["credential_id"] = credential_id
    response = client.post("/api/profiles", json=profile_request)
    assert response.status_code == 201, response.text
    profile_id = response.json()["id"]
    workflow = json.loads((EXAMPLES / "workflow.legacy.json").read_text(encoding="utf-8").replace("profile_REPLACE_WITH_YOUR_PROFILE_ID", profile_id))
    # Exercise save only against the fake transport; the shipped example stays
    # fixed to preview and does not accept an external mode override.
    workflow["settings"]["run_mode"] = "preview" if mode == "preview" else "live"
    if legacy:
        loop = next(node for node in workflow["nodes"] if node["id"] == "each")
        save = next(node for node in loop["subflows"]["body"]["nodes"] if node["id"] == "save")
        save["type"] = "a3.purchase_save"
        save["config"]["mode"] = "save"
    response = client.post("/api/workflows", json=workflow)
    assert response.status_code == 200, response.text
    csv = tmp_path / "purchase.csv"
    text = (EXAMPLES / "purchase.csv").read_text(encoding="utf-8-sig")
    if bad_row:
        text += "CGDD2,测试仓库,warehouse-test,2026-10-15,212,-1,120.00\n"
    csv.write_text(text, encoding="utf-8-sig")
    calls = []
    record = json.loads(Path("tests/fixtures/a3_purchase/purchase_order_line.json").read_text(encoding="utf-8"))

    def request(method, url, *, headers, json, timeout):
        calls.append((url, json))
        if url.endswith("/uc/login/login"):
            return httpx.Response(200, json={"code": "200", "data": {"access_token": "offline-access-token", "token_uuid": "offline-token-uuid"}})
        assert headers["access_token"] == "offline-access-token"
        if url.endswith("defaultPage"):
            return httpx.Response(200, json={"success": not fail_query, "code": "200", "data": {"records": [record]}})
        if url.endswith("defaultSaveOrUpdate"):
            return httpx.Response(200, json={"code": "200", "data": "saved-document-id"})
        raise AssertionError(f"Unexpected offline endpoint: {url}")

    monkeypatch.setattr(httpx, "request", request)
    response = client.post(f"/api/workflows/{workflow['id']}/runs", json={"initial_input": {"csv_path": str(csv), "mode": mode}})
    assert response.status_code == 200, response.text
    run = response.json()
    asyncio.run(app.state.executor.execute(run["id"], app.state.storage.get_workflow(workflow["id"])))
    events = app.state.storage.list_events(run["id"])
    return app, client, profile_id, credential_id, run, events, calls, profile_request, csv, record


@pytest.mark.parametrize("mode", ["preview", "save"])
def test_composed_workflow_matches_baogong_payload_and_request_order(tmp_path, monkeypatch, mode):
    from a3_tool.inputs.csv_tasks import CsvTaskPlanner
    from a3_tool.inputs.purchase.stock_in_csv import PurchaseStockInCsvAdapter
    from a3_tool.core.config import PurchaseSettings, StockInCategorySettings
    from a3_tool.workflows.purchase.stock_in import ExecutionMode, PurchaseStockInWorkflow

    app, client, profile_id, credential_id, run, events, calls, profile, csv, record = prepare(tmp_path, monkeypatch, mode=mode)
    assert app.state.storage.get_run(run["id"]).status == "succeeded"
    cfg = profile["data"]
    settings = PurchaseSettings(cfg["purchase_order_menu_code"], "BZRK", {key: StockInCategorySettings(**value) for key, value in cfg["stock_in_categories"].items()})
    plan = CsvTaskPlanner(PurchaseStockInCsvAdapter(settings)).plan(csv)

    class Capabilities:
        def find_stockable_order_lines(self, order_code, category):
            return [record]

        def save_stock_in(self, payload, category):
            return "saved-document-id"

    baseline = PurchaseStockInWorkflow(Capabilities(), Capabilities(), settings).run(plan.tasks[0].value, mode=ExecutionMode(mode))
    result = next(event.payload["outputs"]["success"] for event in events if event.node_id == "save" and event.type == "node_succeeded")
    assert result["payload"] == baseline.payload
    assert result["document_id"] == baseline.document_id
    assert [url.rsplit("/", 1)[-1] for url, _ in calls] == (["login", "defaultPage", "defaultSaveOrUpdate"] if mode == "save" else ["login", "defaultPage"])
    serialized = json.dumps([event.model_dump() for event in events])
    assert "offline-password" not in serialized
    assert "offline-access-token" not in serialized
    assert "offline-token-uuid" not in serialized
    summary = next(event.payload["outputs"]["success"] for event in events if event.node_id == "summary" and event.type == "node_succeeded")
    assert (summary["total"], summary["succeeded"], summary["failed"]) == (1, 1, 0)
    assert client.delete(f"/api/credentials/{credential_id}").status_code == 409
    assert client.delete(f"/api/profiles/{profile_id}").status_code == 409


def test_input_failure_preserves_successful_documents_in_summary(tmp_path, monkeypatch):
    app, client, _, _, run, events, calls, *_ = prepare(tmp_path, monkeypatch, mode="save", bad_row=True)
    assert app.state.storage.get_run(run["id"]).status == "failed"
    summary = next(event.payload["outputs"]["failed"] for event in events if event.node_id == "summary" and event.type == "node_succeeded")
    assert (summary["total"], summary["succeeded"], summary["failed"]) == (2, 1, 1)
    assert summary["results"][0]["document_id"] == "saved-document-id"
    assert sum(url.endswith("defaultSaveOrUpdate") for url, _ in calls) == 1
    assert client.post(f"/api/runs/{run['id']}/retry").status_code == 409


def test_query_failure_never_reaches_save(tmp_path, monkeypatch):
    app, _, _, _, run, events, calls, *_ = prepare(tmp_path, monkeypatch, mode="save", fail_query=True)
    assert app.state.storage.get_run(run["id"]).status == "failed"
    assert not any(url.endswith("defaultSaveOrUpdate") for url, _ in calls)
    summary = next(event.payload["outputs"]["failed"] for event in events if event.node_id == "summary" and event.type == "node_succeeded")
    assert summary["failed"] == 1


def test_platform_preview_overrides_legacy_save_configuration(tmp_path, monkeypatch):
    app, _, _, _, run, events, calls, *_ = prepare(tmp_path, monkeypatch, legacy=True)
    assert app.state.storage.get_run(run["id"]).status == "succeeded"
    assert app.state.storage.get_run(run["id"]).run_mode == "preview"
    assert not any(url.endswith("defaultSaveOrUpdate") for url, _ in calls)
    planned = next(event for event in events if event.node_id == "save" and event.type == "node_previewed")
    assert planned.payload["effects"][0]["operation"] == "create_document"
    assert planned.payload["outputs"]["success"]["document_id"] is None


def test_two_purchase_plans_do_not_mix_results_and_share_one_login(tmp_path, monkeypatch):
    app, client, _, _, _, _, calls, _, csv, _ = prepare(tmp_path, monkeypatch)
    workflow = app.state.storage.get_workflow("a3_purchase_example").model_dump(mode="json")
    names = {name: f"{name}_second" for name in ("csv", "tasks", "each", "summary", "loop_input", "query", "build", "save", "loop_output")}

    def rename(value):
        if isinstance(value, list):
            return [rename(item) for item in value]
        if isinstance(value, dict):
            result = {key: rename(item) for key, item in value.items()}
            for key in ("sourceHandle", "targetHandle"):
                if key in value:
                    result[key] = value[key]
            if "id" in result:
                result["id"] = names.get(value["id"], value["id"] + "_second")
            return result
        if isinstance(value, str):
            return names.get(value, value.replace("nodes.tasks.", "nodes.tasks_second."))
        return value

    workflow["nodes"].extend(rename(workflow["nodes"][2:]))
    workflow["edges"].extend(rename([edge for edge in workflow["edges"] if edge["source"] in names or edge["target"] in names]))
    response = client.post("/api/workflows", json=workflow)
    assert response.status_code == 200, response.text
    calls.clear()
    run = client.post("/api/workflows/a3_purchase_example/runs", json={"initial_input": {"csv_path": str(csv)}}).json()
    asyncio.run(app.state.executor.execute(run["id"], app.state.storage.get_workflow("a3_purchase_example")))
    assert app.state.storage.get_run(run["id"]).status == "succeeded"
    summaries = [event.payload["outputs"]["success"] for event in app.state.storage.list_events(run["id"]) if event.node_id in {"summary", "summary_second"} and event.type == "node_succeeded"]
    assert len(summaries) == 2
    assert all((report["total"], report["succeeded"], report["failed"]) == (1, 1, 0) for report in summaries)
    assert sum(url.endswith("/login") for url, _ in calls) == 1


@pytest.mark.parametrize("bad_row", [False, True])
def test_in_memory_planning_matches_upstream_without_file_reads(tmp_path, monkeypatch, bad_row):
    import csv
    from dataclasses import asdict
    from a3_tool.core.config import PurchaseSettings, StockInCategorySettings
    from a3_tool.inputs.csv_tasks import CsvTaskPlanner
    from a3_tool.inputs.purchase.stock_in_csv import PurchaseStockInCsvAdapter
    from nodeflow_sdk import NodeContext
    from nodes.a3_purchase_legacy.purchase import PurchaseTasksNode, json_value

    cfg = json.loads((EXAMPLES / "profile.example.json").read_text(encoding="utf-8"))["data"]
    settings = PurchaseSettings(cfg["purchase_order_menu_code"], "BZRK", {key: StockInCategorySettings(**value) for key, value in cfg["stock_in_categories"].items()})
    text = (EXAMPLES / "purchase.csv").read_text(encoding="utf-8-sig")
    if bad_row:
        text += "CGDD2,测试仓库,warehouse-test,2026-10-15,212,-1,120.00\n"
        text += ",测试仓库,warehouse-test,2026-10-15,212,1,120.00\n"
    source = tmp_path / "source.csv"
    source.write_text(text, encoding="utf-8-sig")
    baseline = CsvTaskPlanner(PurchaseStockInCsvAdapter(settings)).plan(source)
    reader = csv.DictReader(text.splitlines())
    rows = list(reader)

    def forbidden(*args, **kwargs):
        raise AssertionError("Business task planning must not read files")

    monkeypatch.setattr(Path, "read_text", forbidden)
    monkeypatch.setattr(Path, "read_bytes", forbidden)
    context = NodeContext(run_id="offline", node_id="tasks", profile={"id": "profile", "data": cfg})
    outputs = asyncio.run(PurchaseTasksNode(config={"profile_id": "profile"}).execute(context, {
        "dataset": {"headers": reader.fieldnames, "rows": rows},
    }))
    assert outputs["tasks"] == [{"ordinal": task.ordinal, "request": json_value(asdict(task.value)),
                                 "line_numbers": list(task.line_numbers), "profile_id": "profile"} for task in baseline.tasks]
    assert outputs["input_failures"] == [{"ordinal": item.ordinal, "line_numbers": list(item.line_numbers),
                                          "errors": [asdict(error) for error in item.errors]} for item in baseline.input_failures]


def test_example_has_explicit_dataflow_and_fixed_preview():
    workflow = json.loads((EXAMPLES / "workflow.legacy.json").read_text(encoding="utf-8"))
    assert all("{{" not in json.dumps(node["config"]) for node in workflow["nodes"])
    parameters = next(node for node in workflow["nodes"] if node["type"] == "workflow.parameters")
    assert [field["name"] for field in parameters["config"]["fields"]] == ["csv_path"]
    loop = next(node for node in workflow["nodes"] if node["id"] == "each")
    save = next(node for node in loop["subflows"]["body"]["nodes"] if node["id"] == "save")
    assert workflow["settings"]["run_mode"] == "preview"
    assert save["type"] == "a3.purchase_submit"
    assert "mode" not in save["config"]
