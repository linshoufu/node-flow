import io
import json
import platform
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.node_package_lease import NodePackageMutationLease
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowNode


def write_node_file(path: Path, *, node_id: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f'''
from nodeflow_sdk import BaseNode, NodeConfig, Output, node


class TempConfig(NodeConfig):
    pass


@node(id="{node_id}", name="Node", category="Test")
class TempNode(BaseNode[TempConfig]):
    outputs = {{"success": Output(description="Done")}}
'''.lstrip(),
        encoding="utf-8",
    )


def write_package_manifest(package_dir: Path) -> None:
    package_dir.mkdir(parents=True, exist_ok=True)
    (package_dir / "nodeflow-package.json").write_text(
        json.dumps(
            {
                "id": "example.tools",
                "name": "Tools",
                "version": "1.0.0",
                "engines": {
                    "nodeflow": ">=0.1.0,<0.2.0",
                    "python": ">=3.11",
                },
                "pythonDependencies": [],
                "nodeEntrypoints": ["node.py"],
            }
        ),
        encoding="utf-8",
    )


def build_package_archive(*, version: str = "1.0.0") -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as package_zip:
        package_zip.writestr(
            "example/nodeflow-package.json",
            json.dumps(
                {
                    "id": "example.installed",
                    "name": "Installed tools",
                    "version": version,
                    "engines": {
                        "nodeflow": ">=0.1.0,<0.2.0",
                        "python": ">=3.11",
                    },
                    "pythonDependencies": [],
                    "nodeEntrypoints": ["node.py"],
                }
            ),
        )
        package_zip.writestr(
            "example/node.py",
            f'''
from nodeflow_sdk import BaseNode, NodeConfig, Output, node


@node(id="example.installed.node", name="Installed", category="Test")
class InstalledNode(BaseNode[NodeConfig]):
    outputs = {{"success": Output(description="Done")}}

    async def execute(self, ctx, inputs):
        return {{"success": {{"version": "{version}"}}}}
'''.lstrip(),
        )
    return output.getvalue()


def test_node_packages_endpoint_returns_snapshot_and_node_provenance(tmp_path: Path):
    write_package_manifest(tmp_path / "tools")
    write_node_file(tmp_path / "tools" / "node.py", node_id="example.node")
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))

    node_types = client.get("/api/node-types").json()
    assert node_types[0]["package"] == {
        "id": "example.tools",
        "name": "Tools",
        "version": "1.0.0",
    }

    response = client.get("/api/node-packages")

    assert response.status_code == 200
    assert response.json() == {
        "packages": [
            {
                "id": "example.tools",
                "name": "Tools",
                "version": "1.0.0",
                "description": None,
                "documentationUrl": None,
                "icon": None,
                    "author": None,
                    "status": "loaded",
                    "nodeIds": ["example.node"],
                    "credentialTypeIds": [],
                    "engines": {
                        "nodeflow": ">=0.1.0,<0.2.0",
                        "python": ">=3.11",
                    },
                    "pythonDependencies": [],
                    "compatibility": {
                        "status": "compatible",
                        "nodeflowVersion": "0.1.0",
                        "pythonVersion": platform.python_version(),
                    },
                    "lifecycle": {
                        "managed": True,
                        "enabled": True,
                        "lockedVersion": None,
                        "versionStatus": "unlocked",
                        "installManaged": False,
                    },
                }
        ],
        "diagnostics": [],
        "legacyNodeCount": 0,
        "recoveries": [],
    }


def test_node_type_reload_keeps_array_response_and_updates_package_diagnostics(tmp_path: Path):
    write_node_file(tmp_path / "healthy.py", node_id="example.healthy")
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))
    (tmp_path / "broken").mkdir()
    (tmp_path / "broken" / "nodeflow-package.json").write_text("{", encoding="utf-8")

    reload_response = client.post("/api/node-types/reload")

    assert isinstance(reload_response.json(), list)
    assert reload_response.json()[0]["id"] == "example.healthy"
    assert client.get("/api/node-packages").json()["diagnostics"][0]["code"] == "package_manifest_invalid"


def test_app_startup_recovers_and_reports_an_interrupted_package_upgrade(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    class SimulatedCrash(BaseException):
        pass

    app = create_app(database_path=":memory:", nodes_dir=tmp_path)
    installer = app.state.node_package_installer
    installer.install_archive(build_package_archive(version="1.0.0"), filename="v1.zip")

    def crash_before_commit(package_id: str, metadata: dict[str, object]) -> None:
        raise SimulatedCrash

    monkeypatch.setattr(installer, "_write_active_metadata", crash_before_commit)
    with pytest.raises(SimulatedCrash):
        installer.install_archive(build_package_archive(version="2.0.0"), filename="v2.zip")

    restarted = create_app(database_path=":memory:", nodes_dir=tmp_path)
    client = TestClient(restarted)
    response = client.get("/api/node-packages")

    assert response.status_code == 200
    assert response.json()["packages"][0]["version"] == "1.0.0"
    assert response.json()["recoveries"] == [
        {
            "transactionId": response.json()["recoveries"][0]["transactionId"],
            "packageId": "example.installed",
            "operation": "activate",
            "action": "rolled_back",
            "recoveredAt": response.json()["recoveries"][0]["recoveredAt"],
        }
    ]


def test_install_returns_structured_conflict_while_another_process_holds_the_lease(
    tmp_path: Path,
):
    app = create_app(database_path=":memory:", nodes_dir=tmp_path)
    installer = app.state.node_package_installer
    installer.mutation_lease.timeout_seconds = 0.05
    competing_lease = NodePackageMutationLease(installer.mutation_lease.path)
    client = TestClient(app)

    with competing_lease.acquire({"operation": "upgrade", "packageId": "example.other"}):
        response = client.post(
            "/api/node-packages/install",
            params={"filename": "blocked.zip"},
            content=build_package_archive(),
            headers={"Content-Type": "application/zip"},
        )
        reload_response = client.post("/api/node-types/reload")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "node_package_mutation_busy"
    assert response.json()["detail"]["owner"]["operation"] == "upgrade"
    assert response.json()["detail"]["owner"]["packageId"] == "example.other"
    assert reload_response.status_code == 409
    assert reload_response.json()["detail"]["code"] == "node_package_mutation_busy"


def test_package_settings_disable_and_reenable_future_node_scans(tmp_path: Path):
    write_package_manifest(tmp_path / "tools")
    write_node_file(tmp_path / "tools" / "node.py", node_id="example.node")
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))

    disabled = client.put(
        "/api/node-packages/example.tools/settings",
        json={"enabled": False, "locked_version": None},
    )

    assert disabled.status_code == 200
    assert disabled.json()["packages"][0]["status"] == "disabled"
    assert disabled.json()["packages"][0]["lifecycle"]["enabled"] is False
    assert client.get("/api/node-types").json() == []

    enabled = client.put(
        "/api/node-packages/example.tools/settings",
        json={"enabled": True, "locked_version": None},
    )

    assert enabled.status_code == 200
    assert enabled.json()["packages"][0]["status"] == "loaded"
    assert client.get("/api/node-types").json()[0]["id"] == "example.node"


def test_installs_and_uninstalls_a_local_zip_package(tmp_path: Path):
    app = create_app(database_path=":memory:", nodes_dir=tmp_path)
    client = TestClient(app)

    installed = client.post(
        "/api/node-packages/install",
        params={"filename": "installed-tools.zip"},
        content=build_package_archive(),
        headers={"Content-Type": "application/zip"},
    )

    assert installed.status_code == 201
    assert installed.json()["action"] == "installed"
    assert installed.json()["package"]["lifecycle"]["installManaged"] is True
    assert client.get("/api/node-types").json()[0]["id"] == "example.installed.node"

    client.put(
        "/api/node-packages/example.installed/settings",
        json={"enabled": True, "locked_version": "1.0.0"},
    )
    uninstalled = client.delete("/api/node-packages/example.installed")

    assert uninstalled.status_code == 200
    assert uninstalled.json()["packages"] == []
    assert client.get("/api/node-types").json() == []
    assert app.state.storage.node_package_policies() == {}


def test_install_api_returns_structured_preflight_error(tmp_path: Path):
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))

    response = client.post(
        "/api/node-packages/install",
        params={"filename": "broken.zip"},
        content=b"not a zip",
        headers={"Content-Type": "application/zip"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "package_archive_invalid",
        "message": "节点包不是有效的 ZIP 文件。",
    }


def test_lists_and_activates_an_installed_package_revision(tmp_path: Path):
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))
    for version in ("1.0.0", "2.0.0"):
        response = client.post(
            "/api/node-packages/install",
            params={"filename": f"tools-v{version}.zip"},
            content=build_package_archive(version=version),
        )
        assert response.status_code == 201

    revisions = client.get(
        "/api/node-packages/example.installed/revisions"
    )

    assert revisions.status_code == 200
    assert len(revisions.json()) == 1
    assert revisions.json()[0]["version"] == "1.0.0"
    assert revisions.json()[0]["sourceFilename"] == "tools-v1.0.0.zip"

    restored = client.post(
        "/api/node-packages/example.installed/revisions/"
        f"{revisions.json()[0]['revisionId']}/activate"
    )

    assert restored.status_code == 200
    assert restored.json()["action"] == "rolled_back"
    assert restored.json()["package"]["version"] == "1.0.0"
    installed_node = client.get("/api/node-types").json()[0]
    assert installed_node["package"]["version"] == "1.0.0"


def test_workspace_package_has_no_installation_history_api(tmp_path: Path):
    write_package_manifest(tmp_path / "tools")
    write_node_file(tmp_path / "tools" / "node.py", node_id="example.node")
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))

    response = client.get("/api/node-packages/example.tools/revisions")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "node_package_not_install_managed"


def test_installed_package_cannot_be_uninstalled_while_referenced(tmp_path: Path):
    app = create_app(database_path=":memory:", nodes_dir=tmp_path)
    client = TestClient(app)
    client.post(
        "/api/node-packages/install",
        params={"filename": "installed-tools.zip"},
        content=build_package_archive(),
    )
    app.state.storage.save_workflow(
        WorkflowDocument(
            id="workflow_using_installed_package",
            name="使用已安装节点",
            nodes=[
                WorkflowNode(
                    id="installed_node",
                    type="example.installed.node",
                    label="已安装步骤",
                    position=Position(x=0, y=0),
                )
            ],
        )
    )

    response = client.delete("/api/node-packages/example.installed")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "node_package_referenced"
    assert response.json()["detail"]["references"][0]["workflow_id"] == (
        "workflow_using_installed_package"
    )
    assert client.get("/api/node-types").json()[0]["id"] == "example.installed.node"


def test_version_lock_requires_explicit_acceptance_after_manifest_upgrade(tmp_path: Path):
    package_dir = tmp_path / "tools"
    write_package_manifest(package_dir)
    write_node_file(package_dir / "node.py", node_id="example.node")
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))

    locked = client.put(
        "/api/node-packages/example.tools/settings",
        json={"enabled": True, "locked_version": "1.0.0"},
    )
    assert locked.json()["packages"][0]["lifecycle"]["versionStatus"] == "locked"

    manifest_path = package_dir / "nodeflow-package.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = "2.0.0"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    client.post("/api/node-types/reload")
    mismatch = client.get("/api/node-packages").json()

    assert client.get("/api/node-types").json() == []
    assert mismatch["packages"][0]["lifecycle"]["versionStatus"] == "mismatch"
    assert mismatch["diagnostics"][0]["code"] == "package_version_lock_mismatch"

    accepted = client.put(
        "/api/node-packages/example.tools/settings",
        json={"enabled": True, "locked_version": "2.0.0"},
    )

    assert accepted.json()["packages"][0]["status"] == "loaded"
    assert accepted.json()["packages"][0]["lifecycle"]["versionStatus"] == "locked"
    assert client.get("/api/node-types").json()[0]["id"] == "example.node"


def test_builtin_package_cannot_be_disabled():
    client = TestClient(create_app(database_path=":memory:", nodes_dir=Path("nodes")))

    response = client.put(
        "/api/node-packages/nodeflow.builtin/settings",
        json={"enabled": False, "locked_version": None},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "内置节点包由平台管理，不能停用或锁定。"


def test_package_cannot_be_disabled_while_a_workflow_uses_its_nodes(tmp_path: Path):
    write_package_manifest(tmp_path / "tools")
    write_node_file(tmp_path / "tools" / "node.py", node_id="example.node")
    app = create_app(database_path=":memory:", nodes_dir=tmp_path)
    app.state.storage.save_workflow(
        WorkflowDocument(
            id="workflow_using_package",
            name="使用扩展节点",
            nodes=[
                WorkflowNode(
                    id="package_node",
                    type="example.node",
                    label="扩展步骤",
                    position=Position(x=0, y=0),
                )
            ],
        )
    )
    client = TestClient(app)

    response = client.put(
        "/api/node-packages/example.tools/settings",
        json={"enabled": False, "locked_version": None},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == {
        "message": "仍有工作流使用该节点包，请先移除相关节点。",
        "references": [
            {
                "workflow_id": "workflow_using_package",
                "workflow_name": "使用扩展节点",
                "node_id": "package_node",
                "node_label": "扩展步骤",
            }
        ],
    }
    assert client.get("/api/node-types").json()[0]["id"] == "example.node"
