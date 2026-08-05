from pathlib import Path

import pytest

from apps.api.nodeflow_api.node_registry import NodeRegistry


def write_node_file(path: Path, *, node_id: str, class_name: str = "TempNode") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"""
from nodeflow_sdk import BaseNode, Input, NodeConfig, Output, node


class TempConfig(NodeConfig):
    pass


@node(id="{node_id}", name="{class_name}", category="Test")
class {class_name}(BaseNode[TempConfig]):
    outputs = {{"success": Output(description="Done")}}
""".lstrip(),
        encoding="utf-8",
    )


def write_rich_node_file(path: Path, *, node_id: str, class_name: str = "RichNode") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"""
from nodeflow_sdk import BaseNode, Input, NodeConfig, Output, node


class TempConfig(NodeConfig):
    pass


@node(
    id="{node_id}",
    name="{class_name}",
    category="Network",
    description="Sends a request.",
    display_name="HTTP Request",
    group="action",
    icon="globe",
    tags=["API", "Network"],
    keywords=["http", "request", "rest"],
    documentation_url="https://example.com/docs/http",
    version=3,
)
class {class_name}(BaseNode[TempConfig]):
    outputs = {{"success": Output(description="Done")}}
""".lstrip(),
        encoding="utf-8",
    )


def test_registry_discovers_builtin_nodes():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    node_ids = {node.id for node in registry.list_node_types()}
    assert "manual.trigger" in node_ids
    assert "http.request" in node_ids
    assert "logic.if" in node_ids
    assert "logic.set_variable" in node_ids
    assert "utility.transform" in node_ids
    assert "control.foreach" in node_ids
    assert "control.while" in node_ids
    assert "data.csv_read" in node_ids
    assert "data.extract" in node_ids
    assert "assert.status_code" in node_ids
    assert "assert.equals" in node_ids
    assert "assert.contains" in node_ids
    assert "test.record_result" in node_ids
    assert "test.summary" in node_ids
    assert "test.write_report" in node_ids


def test_registry_exposes_workflow_composition_nodes():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()

    execute = registry.get("workflow.execute")
    assert execute.inputs["input"]["displayName"] == "输入"
    assert set(execute.outputs) == {"success", "error"}
    assert registry.get("workflow.trigger").group == "trigger"
    assert registry.get("workflow.return").inputs["input"]["required"] is False


def test_registry_exposes_webhook_trigger_contract():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()

    webhook = registry.get("webhook.trigger")
    assert webhook.group == "trigger"
    assert webhook.outputs["success"]["displayName"] == "请求数据"
    assert set(webhook.config_schema["properties"]) == {"method", "path", "response_mode", "credential_id"}
    form = webhook.to_api_dict()["form"]
    assert form is not None
    credential = next(
        field
        for group in form["groups"]
        for field in group["fields"]
        if field["key"] == "credential_id"
    )
    assert credential["credentialTypeIds"] == ["http.header", "webhook.hmac_sha256"]


def test_registry_exposes_schedule_trigger_contract():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()

    schedule = registry.get("schedule.trigger")

    assert schedule.group == "trigger"
    assert schedule.outputs["success"]["displayName"] == "触发数据"
    assert schedule.config_schema["properties"]["interval_seconds"]["minimum"] == 10


def test_registry_returns_json_schema_for_config():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    node_type = registry.get("http.request")
    assert node_type.config_schema["properties"]["url"]["title"] == "URL"
    assert node_type.config_schema["additionalProperties"] is False
    assert node_type.outputs["success"]["description"] == "Response data"


def test_builtin_node_config_schemas_reject_additional_properties():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()

    for node_type in registry.list_node_types():
        assert node_type.config_schema["additionalProperties"] is False



def test_registry_includes_port_schemas(tmp_path: Path):
    (tmp_path / "ports.py").write_text(
        """
from nodeflow_sdk import BaseNode, Input, NodeConfig, Output, node


class TempConfig(NodeConfig):
    pass


@node(id="test.ports", name="Ports", category="Test")
class PortsNode(BaseNode[TempConfig]):
    inputs = {"body": Input(required=False, description="Request body", schema={"type": "object"})}
    outputs = {"rows": Output(description="CSV rows", schema={"type": "array", "items": {"type": "object"}})}
""".lstrip(),
        encoding="utf-8",
    )

    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()

    api_dict = registry.get("test.ports").to_api_dict()
    assert api_dict["inputs"]["body"] == {
        "required": False,
        "description": "Request body",
        "schema": {"type": "object"},
    }
    assert api_dict["outputs"]["rows"] == {
        "description": "CSV rows",
        "schema": {"type": "array", "items": {"type": "object"}},
    }


def test_registry_includes_product_port_metadata(tmp_path: Path):
    (tmp_path / "rich_ports.py").write_text(
        """
from nodeflow_sdk import BaseNode, Input, NodeConfig, Output, node


class TempConfig(NodeConfig):
    pass


@node(id="test.rich_ports", name="Rich Ports", category="Test")
class RichPortsNode(BaseNode[TempConfig]):
    inputs = {
        "body": Input(
            required=False,
            description="Request body",
            display_name="Request body",
            category="data",
            filter={"nodes": ["http.request"]},
            max_connections=None,
        )
    }
    outputs = {
        "error": Output(
            description="Error branch",
            display_name="閿欒",
            category="error",
            filter={"nodes": ["debug.log"]},
            max_connections=2,
        )
    }
""".lstrip(),
        encoding="utf-8",
    )

    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()

    api_dict = registry.get("test.rich_ports").to_api_dict()
    assert api_dict["inputs"]["body"] == {
        "required": False,
        "description": "Request body",
        "displayName": "Request body",
        "category": "data",
        "filter": {"nodes": ["http.request"]},
        "maxConnections": None,
    }
    assert api_dict["outputs"]["error"] == {
        "description": "Error branch",
        "displayName": "閿欒",
        "category": "error",
        "filter": {"nodes": ["debug.log"]},
        "maxConnections": 2,
    }


def test_builtin_nodes_expose_productive_port_schemas():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()

    http_request = registry.get("http.request").to_api_dict()
    assert http_request["inputs"]["headers"]["schema"] == {
        "type": "object",
        "additionalProperties": {"type": "string"},
    }
    assert http_request["outputs"]["success"]["schema"]["properties"]["status_code"] == {
        "type": "integer",
        "minimum": 100,
        "maximum": 599,
    }

    csv_read = registry.get("data.csv_read").to_api_dict()
    assert csv_read["outputs"]["success"]["schema"]["properties"]["rows"] == {
        "type": "array",
        "items": {"type": "object"},
    }

    status_assert = registry.get("assert.status_code").to_api_dict()
    assert status_assert["inputs"]["input"]["schema"]["properties"]["status_code"] == {
        "type": "integer",
        "minimum": 100,
        "maximum": 599,
    }
    assert status_assert["outputs"]["passed"]["schema"]["properties"]["status"] == {
        "type": "string",
        "enum": ["passed", "failed"],
    }


def test_builtin_ports_have_product_display_names():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()

    missing_display_names: list[str] = []
    for node_type in registry.list_node_types():
        api_dict = node_type.to_api_dict()
        for port_name, port in api_dict["inputs"].items():
            if not port.get("displayName"):
                missing_display_names.append(f"{node_type.id}.inputs.{port_name}")
        for port_name, port in api_dict["outputs"].items():
            if not port.get("displayName"):
                missing_display_names.append(f"{node_type.id}.outputs.{port_name}")

    assert missing_display_names == []


def test_builtin_nodes_have_documentation_links():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()

    missing_documentation = [
        node_type.id
        for node_type in registry.list_node_types()
        if not node_type.to_api_dict().get("documentationUrl")
    ]

    assert missing_documentation == []


def test_builtin_node_documentation_links_resolve_to_static_sections():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    public_root = Path("apps/web/public")

    missing_targets: list[str] = []
    for node_type in registry.list_node_types():
        documentation_url = node_type.to_api_dict().get("documentationUrl") or ""
        path, _, anchor = documentation_url.partition("#")
        public_path = public_root / path.lstrip("/")
        if not public_path.exists():
            missing_targets.append(f"{node_type.id}: missing file {path}")
            continue
        if not anchor:
            missing_targets.append(f"{node_type.id}: missing anchor")
            continue
        document = public_path.read_text(encoding="utf-8")
        if f'id="{anchor}"' not in document:
            missing_targets.append(f"{node_type.id}: missing anchor #{anchor}")

    assert missing_targets == []


def test_registry_recursively_discovers_nested_nodes(tmp_path: Path):
    write_node_file(tmp_path / "nested" / "deeper" / "node.py", node_id="test.nested")

    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()

    assert registry.has("test.nested") is True


def test_registry_ignores_private_files(tmp_path: Path):
    write_node_file(tmp_path / "_private.py", node_id="test.private")

    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()

    assert registry.has("test.private") is False


def test_registry_reports_duplicate_node_ids_and_keeps_the_first_node(tmp_path: Path):
    write_node_file(tmp_path / "first.py", node_id="test.duplicate", class_name="FirstNode")
    write_node_file(tmp_path / "second.py", node_id="test.duplicate", class_name="SecondNode")

    registry = NodeRegistry(nodes_dir=tmp_path)

    result = registry.scan()

    assert registry.get("test.duplicate").name == "FirstNode"
    assert [issue.code for issue in result.diagnostics] == ["node_id_duplicate"]


def test_registry_get_missing_node_raises_clear_key_error(tmp_path: Path):
    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()

    with pytest.raises(KeyError, match="Unknown node type: missing"):
        registry.get("missing")


def test_registry_has_reports_presence(tmp_path: Path):
    write_node_file(tmp_path / "node.py", node_id="test.exists")

    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()

    assert registry.has("test.exists") is True
    assert registry.has("test.missing") is False


def test_registry_publishes_a_complete_previous_snapshot_while_reloading(tmp_path: Path, monkeypatch):
    node_file = tmp_path / "node.py"
    write_node_file(node_file, node_id="test.atomic", class_name="BeforeReload")
    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()
    original_load_file = NodeRegistry._load_file
    observed_names: list[str | None] = []

    def capture_published_snapshot(self, file_path, *, package=None):
        snapshot = registry.snapshot()
        observed_names.append(snapshot.get("test.atomic").name if snapshot.has("test.atomic") else None)
        return original_load_file(self, file_path, package=package)

    monkeypatch.setattr(NodeRegistry, "_load_file", capture_published_snapshot)
    write_node_file(node_file, node_id="test.atomic", class_name="AfterReload")

    registry.scan()

    assert observed_names == ["BeforeReload"]
    assert registry.get("test.atomic").name == "AfterReload"


def test_registry_scan_if_changed_refreshes_only_when_node_sources_change(tmp_path: Path):
    first_node = tmp_path / "first.py"
    write_node_file(first_node, node_id="test.first")
    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()

    assert registry.scan_if_changed() is False

    write_node_file(tmp_path / "nested" / "second.py", node_id="test.second")

    assert registry.scan_if_changed() is True
    assert registry.has("test.first") is True
    assert registry.has("test.second") is True
    assert registry.scan_if_changed() is False

    (tmp_path / "nodeflow-package.json").write_text("{}", encoding="utf-8")

    assert registry.scan_if_changed() is True
    assert [diagnostic.code for diagnostic in registry.scan_result.diagnostics] == [
        "package_manifest_invalid"
    ]
    assert registry.scan_if_changed() is False


def test_registered_node_type_api_dict_omits_node_class(tmp_path: Path):
    write_node_file(tmp_path / "node.py", node_id="test.api")

    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()

    api_dict = registry.get("test.api").to_api_dict()
    assert api_dict["configSchema"]["additionalProperties"] is False
    assert api_dict["inputs"] == {}
    assert api_dict["outputs"] == {"success": {"description": "Done"}}
    assert "node_class" not in api_dict


def test_registered_node_type_api_dict_includes_product_metadata(tmp_path: Path):
    write_rich_node_file(tmp_path / "rich.py", node_id="test.rich")

    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()

    api_dict = registry.get("test.rich").to_api_dict()
    assert api_dict["displayName"] == "HTTP Request"
    assert api_dict["group"] == "action"
    assert api_dict["icon"] == "globe"
    assert api_dict["tags"] == ["API", "Network"]
    assert api_dict["keywords"] == ["http", "request", "rest"]
    assert api_dict["documentationUrl"] == "https://example.com/docs/http"
    assert api_dict["version"] == 3


def test_registry_does_not_register_imported_decorated_node_classes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    write_node_file(tmp_path / "source.py", node_id="test.source", class_name="SourceNode")
    (tmp_path / "importer.py").write_text(
        """
from source import SourceNode
""".lstrip(),
        encoding="utf-8",
    )
    monkeypatch.syspath_prepend(str(tmp_path))

    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()

    assert {node.id for node in registry.list_node_types()} == {"test.source"}


def test_registry_module_names_avoid_same_basename_collisions(tmp_path: Path):
    write_node_file(tmp_path / "first" / "node.py", node_id="test.first", class_name="FirstNode")
    write_node_file(tmp_path / "second" / "node.py", node_id="test.second", class_name="SecondNode")

    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()

    assert registry.has("test.first") is True
    assert registry.has("test.second") is True
