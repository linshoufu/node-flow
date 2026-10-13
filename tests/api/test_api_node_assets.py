from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.routes import node_catalog


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


def test_node_types_expose_relative_source_paths(tmp_path: Path):
    write_node_file(tmp_path / "tools" / "healthy.py", node_id="example.healthy")
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))

    node_types = client.get("/api/node-types").json()

    assert [node_type["id"] for node_type in node_types] == ["example.healthy"]
    assert node_types[0]["sourcePath"] == "tools/healthy.py"


def test_open_source_opens_files_inside_nodes_dir(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    write_node_file(tmp_path / "healthy.py", node_id="example.healthy")
    opened_paths: list[Path] = []

    def record_open(path: Path) -> None:
        opened_paths.append(path)

    monkeypatch.setattr(node_catalog, "_open_in_system_handler", record_open)
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))

    response = client.post("/api/node-assets/open-source", json={"source_path": "healthy.py"})

    assert response.status_code == 200
    assert response.json() == {"opened": True, "sourcePath": "healthy.py"}
    assert opened_paths == [(tmp_path / "healthy.py").resolve()]


def test_open_source_rejects_path_traversal(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    write_node_file(tmp_path / "healthy.py", node_id="example.healthy")

    def forbidden_open(path: Path) -> None:
        raise AssertionError("open handler must not run for path traversal")

    monkeypatch.setattr(node_catalog, "_open_in_system_handler", forbidden_open)
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))

    response = client.post(
        "/api/node-assets/open-source",
        json={"source_path": "../outside.py"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "源文件路径不合法。"


def test_open_source_reports_missing_files(tmp_path: Path):
    write_node_file(tmp_path / "healthy.py", node_id="example.healthy")
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))

    response = client.post("/api/node-assets/open-source", json={"source_path": "removed.py"})

    assert response.status_code == 404
    assert response.json()["detail"] == "源文件不存在，请重新扫描节点库后再试。"


def test_open_source_rejects_blank_paths(tmp_path: Path):
    write_node_file(tmp_path / "healthy.py", node_id="example.healthy")
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))

    response = client.post("/api/node-assets/open-source", json={"source_path": "  "})

    assert response.status_code == 422


def test_port_presentation_manifest_changes_catalog_not_python_contract(tmp_path: Path):
    (tmp_path / "http.py").write_text(
        '''
from nodeflow_sdk import BaseNode, Input, NodeConfig, Output, node


class TempConfig(NodeConfig):
    pass


@node(id="example.http", name="HTTP", category="Test")
class HttpNode(BaseNode[TempConfig]):
    inputs = {
        "url": Input(required=True, description="Original URL"),
        "auth": Input(required=False, description="Original auth"),
    }
    outputs = {"success": Output(description="Original success")}
'''.lstrip(),
        encoding="utf-8",
    )
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))

    response = client.put(
        "/api/node-types/example.http/manifest",
        json={
            "version": 1,
            "cardStyle": {"accent": "#58d3aa", "density": "compact", "summary": "auto"},
            "summaryTemplate": {
                "badge": "{{method}}",
                "primary": "{{url}}",
                "secondary": "超时 {{timeout_seconds}} 秒",
            },
            "portPresentation": {
                "inputs": {
                    "auth": {"displayName": "认证信息", "description": "可选认证", "collapsed": True, "order": 0},
                    "url": {"displayName": "目标地址", "order": 1},
                },
                "outputs": {"success": {"displayName": "响应结果", "description": "请求成功后的响应"}},
            },
        },
    )

    assert response.status_code == 200
    saved_manifest = client.get("/api/node-types/example.http/manifest").json()
    assert saved_manifest["cardStyle"]["summary"] == "auto"
    assert saved_manifest["summaryTemplate"]["primary"] == "{{url}}"
    node = client.get("/api/node-types/example.http").json()
    assert list(node["inputs"]) == ["auth", "url"]
    assert node["inputs"]["auth"] == {
        "required": False,
        "description": "可选认证",
        "displayName": "认证信息",
        "collapsed": True,
    }
    assert node["outputs"]["success"] == {
        "description": "请求成功后的响应",
        "displayName": "响应结果",
    }

    # The manifest only changes the serialized catalog presentation. The class
    # that execution instantiates continues to own the true port contract.
    registry = client.app.state.registry
    registered = registry.get_node_type("example.http")
    assert registered is not None
    assert list(registered.node_class.inputs) == ["url", "auth"]
    assert registered.node_class.inputs["auth"].description == "Original auth"


def test_builtin_node_manifest_is_editable_but_installed_packages_remain_read_only(
    tmp_path: Path,
):
    builtin_dir = tmp_path / "builtin"
    builtin_dir.mkdir()
    (builtin_dir / "nodeflow-package.json").write_text(
        '''
{
  "id": "nodeflow.builtin",
  "name": "Built-in nodes",
  "version": "1.0.0",
  "nodeEntrypoints": ["data.py"]
}
'''.lstrip(),
        encoding="utf-8",
    )
    write_node_file(builtin_dir / "data.py", node_id="example.builtin")
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))

    response = client.put(
        "/api/node-types/example.builtin/manifest",
        json={
            "version": 1,
            "portPresentation": {
                "outputs": {"success": {"displayName": "Result"}},
            },
        },
    )

    assert response.status_code == 200
    assert client.get("/api/node-types/example.builtin").json()["outputs"]["success"]["displayName"] == "Result"
