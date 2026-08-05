import importlib
import warnings
from pathlib import Path

from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowNode


def write_versioned_node(path: Path) -> None:
    path.write_text(
        """
from nodeflow_sdk import BaseNode, NodeConfig, node


class VersionedConfig(NodeConfig):
    message: str


@node(id="test.versioned", name="Versioned", category="Test", version=2)
class VersionedNode(BaseNode[VersionedConfig]):
    @classmethod
    def migrate_config(cls, from_version: int, config: dict):
        if from_version == 1:
            return {"message": config["text"]}
        return super().migrate_config(from_version, config)
""".lstrip(),
        encoding="utf-8",
    )


def test_health_check():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_preview_and_apply_node_upgrades_without_mutating_the_saved_version(tmp_path: Path):
    write_versioned_node(tmp_path / "versioned.py")
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))
    legacy = WorkflowDocument(
        id="wf_versioned",
        name="Versioned",
        nodes=[
            WorkflowNode(
                id="node",
                type="test.versioned",
                typeVersion=1,
                position=Position(x=0, y=0),
                config={"text": "hello"},
            )
        ],
        edges=[],
    )
    client.app.state.storage.save_workflow(legacy)

    preview_response = client.post("/api/workflows/wf_versioned/upgrades/preview")

    assert preview_response.status_code == 200
    preview = preview_response.json()
    assert preview["workflow"]["nodes"][0] == {
        "id": "node",
        "type": "test.versioned",
        "disabled": False,
        "label": "",
        "notes": "",
        "typeVersion": 2,
        "position": {"x": 0.0, "y": 0.0},
        "config": {"message": "hello"},
        "subflows": {},
    }
    assert preview["upgrades"] == [
        {
            "nodeId": "node",
            "path": "nodes.node",
            "nodeType": "test.versioned",
            "fromVersion": 1,
            "toVersion": 2,
            "configChanges": [
                {"path": "config.message", "kind": "added", "before": None, "after": "hello"},
                {"path": "config.text", "kind": "removed", "before": "hello", "after": None},
            ],
            "migrationNotes": ["v1 到 v2：新增 config.message；删除 config.text"],
        }
    ]
    assert client.get("/api/workflows/wf_versioned").json()["nodes"][0]["typeVersion"] == 1

    apply_response = client.post("/api/workflows/wf_versioned/upgrades/apply")

    assert apply_response.status_code == 200
    assert apply_response.json()["version"] == 2
    assert apply_response.json()["nodes"][0]["typeVersion"] == 2
    assert client.get("/api/workflows/wf_versioned").json()["nodes"][0]["config"] == {"message": "hello"}


def test_create_app_uses_non_deprecated_lifespan_shutdown():
    with warnings.catch_warnings():
        warnings.simplefilter("error", DeprecationWarning)
        app = create_app(database_path=":memory:", nodes_dir=Path("nodes"))
        with TestClient(app) as client:
            response = client.get("/api/health")

    assert response.status_code == 200


def test_node_types_endpoint_lists_builtin_nodes():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    response = client.get("/api/node-types")
    assert response.status_code == 200
    payload = response.json()
    ids = {node["id"] for node in payload}
    assert "manual.trigger" in ids
    assert "http.request" in ids


def test_node_types_reload_discovers_new_python_node_without_restart(tmp_path):
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))
    assert client.get("/api/node-types").json() == []

    (tmp_path / "demo_node.py").write_text(
        """
from nodeflow_sdk import BaseNode, NodeConfig, NodeContext, Output, node

@node(id="demo.reload", name="Reload Demo", category="Demo", description="Loaded after reload.")
class ReloadDemoNode(BaseNode[NodeConfig]):
    outputs = {"success": Output(description="Done")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": {"ok": True}}
""".lstrip(),
        encoding="utf-8",
    )

    reload_response = client.post("/api/node-types/reload")

    assert reload_response.status_code == 200
    assert {node["id"] for node in reload_response.json()} == {"demo.reload"}
    assert {node["id"] for node in client.get("/api/node-types").json()} == {"demo.reload"}


def test_cors_allows_fallback_vite_localhost_ports():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))

    for origin in ["http://127.0.0.1:5273", "http://127.0.0.1:5274", "http://localhost:5273"]:
        response = client.options(
            "/api/node-types",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
            },
        )

        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin


def test_cors_allows_explicitly_configured_local_origin(monkeypatch):
    origin = "http://127.0.0.1:5275"
    monkeypatch.setenv("NODE_FLOW_EXTRA_CORS_ORIGINS", origin)
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))

    response = client.options(
        "/api/node-types",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_cors_rejects_legacy_localhost_ports():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    legacy_web_port = "51" + "73"
    legacy_api_port = "80" + "50"

    for origin in [
        f"http://127.0.0.1:{legacy_web_port}",
        f"http://localhost:{legacy_web_port}",
        f"http://127.0.0.1:{legacy_api_port}",
    ]:
        response = client.options(
            "/api/node-types",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
            },
        )

        assert response.status_code == 400
        assert "access-control-allow-origin" not in response.headers


def test_workflow_endpoints_save_get_and_list_workflows():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    workflow = {
        "id": "workflow_1",
        "name": "Demo Workflow",
        "active": True,
        "description": "A workflow used for smoke checks.",
        "tags": ["smoke", "automation"],
        "nodes": [
            {
                "id": "node_1",
                "type": "manual.trigger",
                "label": "准备输入数据",
                "notes": "仅连接测试环境服务。",
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
    assert get_response.json()["description"] == "A workflow used for smoke checks."
    assert get_response.json()["tags"] == ["smoke", "automation"]
    assert get_response.json()["nodes"][0]["label"] == "准备输入数据"
    assert get_response.json()["nodes"][0]["notes"] == "仅连接测试环境服务。"
    assert list_response.status_code == 200
    summary = list_response.json()[0]
    assert summary == {
        "id": "workflow_1",
        "name": "Demo Workflow",
        "active": True,
        "description": "A workflow used for smoke checks.",
        "tags": ["smoke", "automation"],
        "version": 1,
        "updated_at": summary["updated_at"],
        "node_count": 1,
        "last_run_status": None,
    }
    assert summary["updated_at"] is not None


def test_workflow_delete_removes_saved_versions_and_run_history():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    workflow = {
        "id": "workflow_delete",
        "name": "Delete me",
        "active": False,
        "nodes": [
            {
                "id": "trigger",
                "type": "manual.trigger",
                "position": {"x": 0, "y": 0},
                "config": {},
            }
        ],
        "edges": [],
    }

    assert client.post("/api/workflows", json=workflow).status_code == 200
    assert client.post("/api/workflows/workflow_delete/runs").status_code == 200

    response = client.delete("/api/workflows/workflow_delete")

    assert response.status_code == 204
    assert client.get("/api/workflows/workflow_delete").status_code == 404
    assert client.get("/api/workflows/workflow_delete/runs").status_code == 404
    assert client.get("/api/workflows").json() == []

    recreated = client.post("/api/workflows", json={**workflow, "name": "Recreated"})
    assert recreated.status_code == 200
    assert recreated.json()["version"] == 1
    assert recreated.json()["name"] == "Recreated"


def test_workflow_delete_rejects_missing_open_and_referenced_workflows():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    child = {
        "id": "workflow_child",
        "name": "Child workflow",
        "active": False,
        "nodes": [{"id": "trigger", "type": "workflow.trigger", "position": {"x": 0, "y": 0}, "config": {}}],
        "edges": [],
    }
    parent = {
        "id": "workflow_parent",
        "name": "Parent workflow",
        "active": False,
        "nodes": [
            {
                "id": "trigger",
                "type": "manual.trigger",
                "position": {"x": 0, "y": 0},
                "config": {},
            },
            {
                "id": "delay",
                "type": "utility.delay",
                "position": {"x": 180, "y": 0},
                "config": {"seconds": 10},
            },
            {
                "id": "call_child",
                "type": "workflow.execute",
                "position": {"x": 360, "y": 0},
                "config": {"workflow_id": "workflow_child"},
            }
        ],
        "edges": [
            {
                "id": "trigger-to-delay",
                "source": "trigger",
                "sourceHandle": "success",
                "target": "delay",
                "targetHandle": "input",
            }
        ],
    }

    assert client.post("/api/workflows", json=child).status_code == 200
    assert client.post("/api/workflows", json=parent).status_code == 200

    missing = client.delete("/api/workflows/missing")
    referenced = client.delete("/api/workflows/workflow_child")
    open_run = client.post("/api/workflows/workflow_parent/runs")
    running = client.delete("/api/workflows/workflow_parent")

    assert missing.status_code == 404
    assert missing.json() == {"detail": "工作流不存在。"}
    assert referenced.status_code == 409
    assert referenced.json()["detail"] == {
        "message": "工作流仍被其他工作流调用，无法删除。",
        "code": "workflow_in_use",
        "references": [
            {
                "workflow_id": "workflow_parent",
                "workflow_name": "Parent workflow",
                "node_id": "call_child",
                "node_label": "call_child",
            }
        ],
    }
    assert open_run.status_code == 200
    assert running.status_code == 409
    assert running.json()["detail"] == {
        "message": "工作流仍有排队或运行中的任务，无法删除。",
        "code": "workflow_has_open_runs",
    }


def test_workflow_trigger_status_lists_saved_webhook_and_schedule_bindings():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    workflow = {
        "id": "workflow_triggers",
        "name": "Trigger status",
        "active": True,
        "nodes": [
            {
                "id": "schedule",
                "type": "schedule.trigger",
                "position": {"x": 0, "y": 0},
                "config": {"interval_seconds": 60},
            },
            {
                "id": "webhook",
                "type": "webhook.trigger",
                "position": {"x": 0, "y": 120},
                "config": {"method": "POST", "path": "hooks/status"},
            },
        ],
        "edges": [],
    }

    assert client.post("/api/workflows", json=workflow).status_code == 200
    response = client.get("/api/workflows/workflow_triggers/triggers")

    assert response.status_code == 200
    assert response.json() == [
        {
            "node_id": "schedule",
            "type": "schedule.trigger",
            "active": True,
            "interval_seconds": 60,
            "next_run_at": None,
            "details": {},
        },
        {
            "node_id": "webhook",
            "type": "webhook.trigger",
            "active": True,
            "interval_seconds": None,
            "next_run_at": None,
            "details": {"method": "POST", "path": "hooks/status"},
        },
    ]


def test_workflow_version_history_can_restore_an_older_version_as_a_new_version():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    initial = {"id": "workflow_versions", "name": "Initial name", "active": False, "nodes": [], "edges": []}
    changed = {**initial, "name": "Changed name", "active": True}

    assert client.post("/api/workflows", json=initial).json()["version"] == 1
    assert client.post("/api/workflows", json=changed).json()["version"] == 2

    history_response = client.get("/api/workflows/workflow_versions/versions")

    assert history_response.status_code == 200
    assert history_response.json() == [
        {
            "version": 2,
            "created_at": history_response.json()[0]["created_at"],
            "name": "Changed name",
            "active": True,
            "node_count": 0,
            "action": "save",
            "source_version": None,
        },
        {
            "version": 1,
            "created_at": history_response.json()[1]["created_at"],
            "name": "Initial name",
            "active": False,
            "node_count": 0,
            "action": "save",
            "source_version": None,
        },
    ]
    assert client.get("/api/workflows/workflow_versions/versions/1").json()["name"] == "Initial name"

    restore_response = client.post("/api/workflows/workflow_versions/versions/1/restore")

    assert restore_response.status_code == 200
    assert restore_response.json()["version"] == 3
    assert restore_response.json()["name"] == "Initial name"
    assert restore_response.json()["active"] is True
    assert client.get("/api/workflows/workflow_versions/publication").json() == {
        "workflow_id": "workflow_versions",
        "draft_version": 3,
        "published_version": 2,
        "active": True,
        "has_unpublished_changes": True,
    }
    assert client.get("/api/workflows/workflow_versions").json()["version"] == 3
    restored_history = client.get("/api/workflows/workflow_versions/versions").json()
    assert restored_history[0]["action"] == "restore"
    assert restored_history[0]["source_version"] == 1


def test_published_workflow_can_roll_back_a_historical_version_as_a_new_production_version():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    first = {"id": "workflow_rollback", "name": "First release", "active": True, "nodes": [], "edges": []}
    second = {**first, "name": "Second release"}

    assert client.post("/api/workflows", json=first).json()["version"] == 1
    assert client.post("/api/workflows", json=second).json()["version"] == 2

    response = client.post("/api/workflows/workflow_rollback/versions/1/rollback")

    assert response.status_code == 200
    assert response.json()["version"] == 3
    assert response.json()["name"] == "First release"
    assert response.json()["active"] is True
    assert client.get("/api/workflows/workflow_rollback/publication").json() == {
        "workflow_id": "workflow_rollback",
        "draft_version": 3,
        "published_version": 3,
        "active": True,
        "has_unpublished_changes": False,
    }
    history = client.get("/api/workflows/workflow_rollback/versions").json()
    assert history[0]["action"] == "rollback"
    assert history[0]["source_version"] == 1
    assert history[1]["action"] == "save"


def test_production_rollback_requires_an_active_published_workflow_and_existing_version():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    workflow = {"id": "workflow_unpublished", "name": "Draft only", "active": False, "nodes": [], "edges": []}
    assert client.post("/api/workflows?draft=true", json=workflow).status_code == 200

    inactive = client.post("/api/workflows/workflow_unpublished/versions/1/rollback")
    missing = client.post("/api/workflows/missing/versions/1/rollback")

    assert inactive.status_code == 409
    assert inactive.json() == {"detail": "工作流尚未发布，无法回滚生产版本。"}
    assert missing.status_code == 404


def test_save_workflow_rejects_invalid_workflow_setting_variable_names():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    workflow = {
        "id": "workflow_bad_vars",
        "name": "Bad Variables",
        "settings": {"variables": {"base-url": "https://api.example.com"}},
        "nodes": [],
        "edges": [],
    }

    response = client.post("/api/workflows", json=workflow)

    assert response.status_code == 422
    assert response.json()["detail"] == [
        {
            "path": "settings.variables.base-url",
            "message": "变量名只能包含字母、数字和下划线，且不能以数字开头。",
        }
    ]


def test_save_workflow_returns_a_structured_conflict_for_a_stale_version():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    workflow = {
        "id": "workflow_save_conflict",
        "name": "Initial",
        "active": False,
        "nodes": [],
        "edges": [],
    }
    first = client.post("/api/workflows?draft=true", json=workflow).json()
    second = client.post(
        "/api/workflows?draft=true",
        json={**first, "name": "Current"},
        headers={"X-Workflow-Expected-Version": "1"},
    )

    stale = client.post(
        "/api/workflows?draft=true",
        json={**first, "name": "Stale overwrite"},
        headers={"X-Workflow-Expected-Version": "1"},
    )

    assert second.status_code == 200
    assert second.json()["version"] == 2
    assert stale.status_code == 409
    assert stale.json() == {
        "detail": {
            "code": "workflow_version_conflict",
            "message": "工作流已被其他操作更新，请重新加载后再保存。",
            "expected_version": 1,
            "current_version": 2,
        }
    }
    assert client.get("/api/workflows/workflow_save_conflict").json()["name"] == "Current"


def test_workflow_mutation_endpoints_reject_a_stale_version_without_changing_state():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    workflow = {
        "id": "workflow_mutation_conflict",
        "name": "Initial",
        "active": True,
        "nodes": [],
        "edges": [],
    }
    first = client.post("/api/workflows", json=workflow).json()
    second = client.post(
        "/api/workflows",
        json={**first, "name": "Current"},
        headers={"X-Workflow-Expected-Version": "1"},
    ).json()
    headers = {"X-Workflow-Expected-Version": "1"}

    responses = (
        client.post(
            "/api/workflows/workflow_mutation_conflict/activation",
            json={"active": False},
            headers=headers,
        ),
        client.post(
            "/api/workflows/workflow_mutation_conflict/versions/1/restore",
            headers=headers,
        ),
        client.post(
            "/api/workflows/workflow_mutation_conflict/versions/1/rollback",
            headers=headers,
        ),
        client.post(
            "/api/workflows/workflow_mutation_conflict/upgrades/apply",
            headers=headers,
        ),
    )

    for response in responses:
        assert response.status_code == 409
        assert response.json() == {
            "detail": {
                "code": "workflow_version_conflict",
                "message": "工作流已被其他操作更新，请重新加载后再继续。",
                "expected_version": 1,
                "current_version": 2,
            }
        }

    assert client.get("/api/workflows/workflow_mutation_conflict").json() == second
    publication = client.get("/api/workflows/workflow_mutation_conflict/publication").json()
    assert publication["draft_version"] == 2
    assert publication["published_version"] == 2
    assert [item["version"] for item in client.get(
        "/api/workflows/workflow_mutation_conflict/versions"
    ).json()] == [2, 1]


def test_save_workflow_validates_error_workflow_references():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))
    handler = {
        "id": "workflow_error_handler",
        "name": "Error handler",
        "nodes": [
            {
                "id": "trigger",
                "type": "workflow.trigger",
                "position": {"x": 0, "y": 0},
                "config": {},
            }
        ],
        "edges": [],
    }
    parent = {
        "id": "workflow_with_error_handler",
        "name": "Parent",
        "settings": {"error_workflow_id": handler["id"]},
        "nodes": [],
        "edges": [],
    }
    missing = {
        **parent,
        "id": "workflow_with_missing_error_handler",
        "settings": {"error_workflow_id": "not_saved"},
    }

    assert client.post("/api/workflows", json=handler).status_code == 200
    saved_parent = client.post("/api/workflows", json=parent)
    missing_response = client.post("/api/workflows", json=missing)

    assert saved_parent.status_code == 200
    assert saved_parent.json()["settings"]["error_workflow_id"] == handler["id"]
    assert missing_response.status_code == 422
    assert missing_response.json()["detail"] == [
        {
            "path": "settings.error_workflow_id",
            "message": "引用的错误处理工作流不存在或已删除。",
            "code": "error_workflow_not_found",
        }
    ]


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
