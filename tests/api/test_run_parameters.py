import asyncio
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.schemas import RunInvocation, WorkflowDocument
from nodeflow_sdk.parameters import RunParametersConfig, resolve_parameters


def document(fields):
    return {"id": "parameters-test", "name": "参数测试", "nodes": [
        {"id": "params", "type": "workflow.parameters", "typeVersion": 2, "position": {"x": 0, "y": 0},
         "config": {"fields": fields}},
    ], "edges": []}


def test_parameters_preflight_blocks_invalid_input_and_persists_resolved_values():
    app = create_app(database_path=":memory:", execution_mode="worker")
    client = TestClient(app)
    workflow = document([{"name": "count", "type": "integer"},
                         {"name": "mode", "default": "preview", "options": ["preview", "save"]}])
    assert client.post("/api/workflows", json=workflow).status_code == 200
    for value in ({}, {"count": True}, {"count": "2"}, {"count": 2, "mode": "unknown"}):
        response = client.post("/api/workflows/parameters-test/runs", json={"initial_input": value})
        assert response.status_code == 422
    assert app.state.storage.list_workflow_runs("parameters-test") == []
    response = client.post("/api/workflows/parameters-test/runs", json={"initial_input": {"count": 2}})
    assert response.status_code == 200
    run_id = response.json()["id"]
    invocation = app.state.storage.get_run_invocation(run_id)
    assert invocation.parameters == {"count": 2, "mode": "preview"}
    asyncio.run(app.state.executor.execute(run_id, WorkflowDocument.model_validate(workflow)))
    assert app.state.storage.get_run(run_id).status == "succeeded"
    outputs = [event.payload["outputs"] for event in app.state.storage.list_events(run_id) if event.type == "node_succeeded"]
    assert outputs == [{"count": 2, "mode": "preview"}]


def test_non_manual_launches_use_same_preflight_and_webhook_input_path():
    app = create_app(database_path=":memory:", execution_mode="worker")
    workflow = WorkflowDocument.model_validate(document([{"name": "count", "type": "integer"}]))
    workflow.nodes[0].config["input_path"] = "body"
    workflow = app.state.storage.save_workflow(workflow)
    for mode in ("webhook", "child", "schedule"):
        with pytest.raises(ValueError, match="缺少运行参数"):
            app.state.storage.create_run(workflow, invocation=RunInvocation(execution_mode=mode))
    run = app.state.storage.create_run(workflow, invocation=RunInvocation(execution_mode="webhook", initial_input={"body": {"count": 3}}))
    assert app.state.storage.get_run_invocation(run.id).parameters == {"count": 3}


def test_parameter_declaration_rejects_duplicates_secrets_and_multiple_nodes():
    client = TestClient(create_app(database_path=":memory:"))
    for fields in ([{"name": "x"}, {"name": "x"}], [{"name": "password"}], [{"name": "success"}], [{"name": "n", "type": "integer", "default": "bad"}]):
        assert client.post("/api/workflows", json=document(fields)).status_code == 422
    workflow = document([])
    workflow["nodes"].append({**workflow["nodes"][0], "id": "other"})
    assert client.post("/api/workflows", json=workflow).status_code == 422


def test_parameter_values_are_json_and_type_checked():
    config = RunParametersConfig(fields=[{"name": "enabled", "type": "boolean", "default": False}, {"name": "date", "type": "date"}])
    assert resolve_parameters(config, {"date": "2026-10-15"}) == {"enabled": False, "date": "2026-10-15"}
    with pytest.raises(ValueError):
        resolve_parameters(config, {"date": "yesterday"})
    files = RunParametersConfig(fields=[{"name": "input", "type": "file"}])
    with pytest.raises(ValueError, match="文件不存在"):
        resolve_parameters(files, {"input": "missing-input-for-preflight.csv"})


def test_input_contract_survives_database_reopen(tmp_path: Path):
    database = tmp_path / "test.sqlite3"
    app = create_app(database_path=database, execution_mode="worker")
    workflow = app.state.storage.save_workflow(WorkflowDocument.model_validate(document([{"name": "mode", "default": "preview"}])))
    run = app.state.storage.create_run(workflow)
    second = create_app(database_path=database, execution_mode="worker")
    assert second.state.storage.get_run_invocation(run.id).parameters == {"mode": "preview"}


def test_field_ports_connect_and_removed_bundle_port_is_rejected():
    from apps.api.nodeflow_api.node_ports import resolve_output_port_contract
    from apps.api.nodeflow_api.workflow_node_migrations import preview_workflow_node_upgrades

    app = create_app(database_path=":memory:", execution_mode="worker")
    client = TestClient(app)
    workflow = document([{"name": "count", "type": "integer", "default": 0}])
    workflow["nodes"].append({"id": "consumer", "type": "utility.transform", "position": {"x": 200, "y": 0},
                              "config": {"value": "{{ inputs.input }}"}})
    workflow["edges"] = [{"id": "value", "source": "params", "sourceHandle": "count",
                           "target": "consumer", "targetHandle": "input"}]
    # A v1 node with field connections upgrades without losing definitions.
    workflow["nodes"][0]["typeVersion"] = 1
    upgraded = preview_workflow_node_upgrades(WorkflowDocument.model_validate(workflow), app.state.registry).workflow
    assert upgraded.nodes[0].typeVersion == 2
    assert upgraded.nodes[0].config == workflow["nodes"][0]["config"]
    contract = resolve_output_port_contract(upgraded.nodes[0], app.state.registry.get("workflow.parameters"))
    assert contract.issue is None
    assert set(contract.ports) == {"count"}
    updated = upgraded.model_dump(mode="json")
    assert client.post("/api/workflows", json=updated).status_code == 200
    updated["edges"][0]["sourceHandle"] = "success"
    response = client.post("/api/workflows", json=updated)
    assert response.status_code == 422
    assert any(issue.get("code") == "unknown_source_port" for issue in response.json()["detail"])


def test_empty_parameter_declaration_has_no_outputs():
    from apps.api.nodeflow_api.node_ports import resolve_output_port_contract

    app = create_app(database_path=":memory:", execution_mode="worker")
    workflow = WorkflowDocument.model_validate(document([]))
    contract = resolve_output_port_contract(workflow.nodes[0], app.state.registry.get("workflow.parameters"))
    assert contract.issue is None
    assert contract.ports == {}
    saved = app.state.storage.save_workflow(workflow)
    run = app.state.storage.create_run(saved)
    asyncio.run(app.state.executor.execute(run.id, saved))
    assert app.state.storage.get_run(run.id).status == "succeeded"
    completed = next(event for event in app.state.storage.list_events(run.id) if event.type == "node_succeeded")
    assert completed.payload["outputs"] == {}
