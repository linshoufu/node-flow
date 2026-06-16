from pathlib import Path

import pytest

from apps.api.nodeflow_api.node_registry import NodeRegistry


def write_node_file(path: Path, *, node_id: str, class_name: str = "TempNode") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"""
from nodeflow_sdk import BaseNode, NodeConfig, Output, node


class TempConfig(NodeConfig):
    pass


@node(id="{node_id}", name="{class_name}", category="Test")
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
    assert "control.foreach" in node_ids
    assert "control.while" in node_ids


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


def test_registry_rejects_duplicate_node_ids(tmp_path: Path):
    write_node_file(tmp_path / "first.py", node_id="test.duplicate", class_name="FirstNode")
    write_node_file(tmp_path / "second.py", node_id="test.duplicate", class_name="SecondNode")

    registry = NodeRegistry(nodes_dir=tmp_path)

    with pytest.raises(ValueError, match="Duplicate node id: test.duplicate"):
        registry.scan()


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


def test_registered_node_type_api_dict_omits_node_class(tmp_path: Path):
    write_node_file(tmp_path / "node.py", node_id="test.api")

    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()

    api_dict = registry.get("test.api").to_api_dict()
    assert api_dict["configSchema"]["additionalProperties"] is False
    assert api_dict["inputs"] == {}
    assert api_dict["outputs"] == {"success": {"description": "Done"}}
    assert "node_class" not in api_dict


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
