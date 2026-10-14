import json
from pathlib import Path

import pytest

from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.node_package_lifecycle import NodePackagePolicy


def write_node_file(path: Path, *, node_id: str, class_name: str = "TempNode") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f'''
from nodeflow_sdk import BaseNode, NodeConfig, Output, node


class TempConfig(NodeConfig):
    pass


@node(id="{node_id}", name="{class_name}", category="Test")
class {class_name}(BaseNode[TempConfig]):
    outputs = {{"success": Output(description="Done")}}
'''.lstrip(),
        encoding="utf-8",
    )


def write_package_manifest(
    package_dir: Path,
    *,
    package_id: str,
    entrypoints: list[str],
    name: str = "Tools",
    version: str = "1.0.0",
    engines: dict[str, str] | None = None,
    include_engines: bool = True,
    python_dependencies: list[str] | None = None,
    credential_types: list[dict[str, object]] | None = None,
) -> None:
    package_dir.mkdir(parents=True, exist_ok=True)
    (package_dir / "nodeflow-package.json").write_text(
        json.dumps(
            {
                "id": package_id,
                "name": name,
                "version": version,
                **(
                    {
                        "engines": engines
                        or {
                            "nodeflow": ">=0.1.0,<0.2.0",
                            "python": ">=3.11",
                        }
                    }
                    if include_engines
                    else {}
                ),
                "pythonDependencies": python_dependencies or [],
                "nodeEntrypoints": entrypoints,
                **({"credentialTypes": credential_types} if credential_types is not None else {}),
            }
        ),
        encoding="utf-8",
    )


def test_registry_loads_only_declared_package_entrypoints_and_records_provenance(tmp_path: Path):
    write_package_manifest(
        tmp_path / "tools",
        package_id="example.tools",
        entrypoints=["declared.py"],
    )
    write_node_file(tmp_path / "tools" / "declared.py", node_id="example.declared")
    write_node_file(tmp_path / "tools" / "ignored.py", node_id="example.ignored")

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.has("example.declared")
    assert not registry.has("example.ignored")
    assert registry.get("example.declared").to_api_dict()["package"] == {
        "id": "example.tools",
        "name": "Tools",
        "version": "1.0.0",
    }
    assert result.packages[0].status == "loaded"


def test_registry_keeps_loose_scripts_outside_manifest_directories_as_legacy(tmp_path: Path):
    write_node_file(tmp_path / "scratch.py", node_id="example.legacy")
    write_package_manifest(tmp_path / "tools", package_id="example.tools", entrypoints=[])

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.get("example.legacy").to_api_dict()["package"] is None
    assert result.legacy_node_count == 1

def test_invalid_manifest_is_diagnostic_and_does_not_block_other_nodes(tmp_path: Path):
    (tmp_path / "broken").mkdir()
    (tmp_path / "broken" / "nodeflow-package.json").write_text("{", encoding="utf-8")
    write_node_file(tmp_path / "healthy.py", node_id="example.healthy")

    result = NodeRegistry(nodes_dir=tmp_path).scan()

    assert {issue.code for issue in result.diagnostics} == {"package_manifest_invalid"}
    assert result.legacy_node_count == 1


def test_failing_legacy_script_is_isolated_from_other_nodes(tmp_path: Path):
    (tmp_path / "broken.py").write_text("raise RuntimeError('broken legacy node')\n", encoding="utf-8")
    write_node_file(tmp_path / "healthy.py", node_id="example.healthy")

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.has("example.healthy")
    assert result.legacy_node_count == 1
    assert [diagnostic.code for diagnostic in result.diagnostics] == ["legacy_node_load_failed"]
    assert result.diagnostics[0].path == "broken.py"
    assert "broken legacy node" in result.diagnostics[0].message


def test_missing_and_failing_entrypoints_are_isolated_with_diagnostics(tmp_path: Path):
    write_package_manifest(
        tmp_path / "tools",
        package_id="example.tools",
        entrypoints=["missing.py", "broken.py", "ok.py"],
    )
    (tmp_path / "tools" / "broken.py").write_text("raise RuntimeError('boom')", encoding="utf-8")
    write_node_file(tmp_path / "tools" / "ok.py", node_id="example.ok")

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.has("example.ok")
    assert {issue.code for issue in result.diagnostics} == {
        "package_entrypoint_missing",
        "package_entrypoint_load_failed",
    }
    assert result.packages[0].status == "partial"


def test_invalid_entrypoints_are_diagnostics_and_do_not_escape_the_package(tmp_path: Path):
    write_node_file(tmp_path / "outside.py", node_id="example.outside")
    write_package_manifest(
        tmp_path / "tools",
        package_id="example.tools",
        entrypoints=["../outside.py", "notes.txt"],
    )

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.has("example.outside")
    assert [issue.code for issue in result.diagnostics] == [
        "package_entrypoint_invalid",
        "package_entrypoint_invalid",
    ]
    assert result.packages[0].status == "failed"


def test_duplicate_package_ids_are_diagnostic_with_stable_first_winner(tmp_path: Path):
    write_package_manifest(tmp_path / "a", package_id="example.same", entrypoints=["node.py"])
    write_package_manifest(tmp_path / "b", package_id="example.same", entrypoints=["node.py"])
    write_node_file(tmp_path / "a" / "node.py", node_id="example.first", class_name="FirstNode")
    write_node_file(tmp_path / "b" / "node.py", node_id="example.second", class_name="SecondNode")

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.get("example.first").name == "FirstNode"
    assert not registry.has("example.second")
    assert [issue.code for issue in result.diagnostics] == ["package_id_duplicate"]
    assert [package.status for package in result.packages] == ["loaded", "failed"]


def test_duplicate_node_ids_are_diagnostic_with_stable_first_winner(tmp_path: Path):
    write_node_file(tmp_path / "a.py", node_id="example.duplicate", class_name="FirstNode")
    write_node_file(tmp_path / "b.py", node_id="example.duplicate", class_name="SecondNode")

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.get("example.duplicate").name == "FirstNode"
    assert [issue.code for issue in result.diagnostics] == ["node_id_duplicate"]


def test_invalid_node_port_contracts_are_isolated_with_actionable_diagnostics(tmp_path: Path):
    (tmp_path / "invalid_ports.py").write_text(
        '''
from nodeflow_sdk import BaseNode, Input, NodeConfig, Output, node


@node(id="example.bad_handle", name="Bad Handle", category="Test")
class BadHandleNode(BaseNode[NodeConfig]):
    outputs = {"bad-handle": Output()}


@node(id="example.bad_filter", name="Bad Filter", category="Test")
class BadFilterNode(BaseNode[NodeConfig]):
    inputs = {"input": Input(filter={"nodeTypes": ["example.source"]})}


@node(id="example.bad_capacity", name="Bad Capacity", category="Test")
class BadCapacityNode(BaseNode[NodeConfig]):
    outputs = {"success": Output(max_connections=-1)}
'''.lstrip(),
        encoding="utf-8",
    )
    write_node_file(tmp_path / "healthy.py", node_id="example.healthy")

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.has("example.healthy")
    assert not registry.has("example.bad_handle")
    assert not registry.has("example.bad_filter")
    assert not registry.has("example.bad_capacity")
    diagnostics = [issue for issue in result.diagnostics if issue.code == "node_port_contract_invalid"]
    assert len(diagnostics) == 3
    assert [issue.path for issue in diagnostics] == ["invalid_ports.py"] * 3
    assert "bad-handle" in diagnostics[0].message
    assert "nodeTypes" in diagnostics[1].message
    assert "max_connections" in diagnostics[2].message


def test_builtin_nodes_are_discovered_through_the_builtin_package():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    result = registry.scan()

    assert registry.get("manual.trigger").to_api_dict()["package"] == {
        "id": "nodeflow.builtin",
        "name": "内置节点",
        "version": "1.0.0",
    }
    assert any(package.id == "nodeflow.builtin" for package in result.packages)


def test_package_can_declare_credential_types_for_its_own_nodes(tmp_path: Path):
    write_package_manifest(
        tmp_path / "tools",
        package_id="example.tools",
        entrypoints=["node.py"],
        credential_types=[
            {
                "id": "example.api_key",
                "displayName": "Example API Key",
                "fields": [{"id": "api_key", "label": "API Key", "secret": True}],
                "nodeTypeIds": ["example.request"],
            }
        ],
    )
    write_node_file(tmp_path / "tools" / "node.py", node_id="example.request")

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert result.packages[0].credential_type_ids == ("example.api_key",)
    credential_type = registry.get_credential_type("example.api_key")
    assert credential_type is not None
    assert credential_type.field_definitions[0].id == "api_key"
    assert credential_type.field_definitions[0].secret is True


def test_invalid_package_credential_type_is_isolated_from_its_nodes(tmp_path: Path):
    write_package_manifest(
        tmp_path / "tools",
        package_id="example.tools",
        entrypoints=["node.py"],
        credential_types=[
            {
                "id": "example.invalid",
                "displayName": "Invalid",
                "fields": [{"id": "token", "label": "Token", "secret": True}],
                "nodeTypeIds": ["another.package.node"],
            }
        ],
    )
    write_node_file(tmp_path / "tools" / "node.py", node_id="example.request")

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.has("example.request")
    assert registry.get_credential_type("example.invalid") is None
    assert result.packages[0].status == "partial"
    assert [diagnostic.code for diagnostic in result.diagnostics] == ["package_credential_type_invalid"]


def test_package_without_engine_constraints_loads_as_unverified(tmp_path: Path):
    write_package_manifest(
        tmp_path / "legacy-package",
        package_id="example.legacy_package",
        entrypoints=["node.py"],
        include_engines=False,
    )
    write_node_file(tmp_path / "legacy-package" / "node.py", node_id="example.legacy_package.node")

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.has("example.legacy_package.node")
    assert result.packages[0].status == "loaded"
    assert result.packages[0].compatibility == "unverified"
    assert [diagnostic.code for diagnostic in result.diagnostics] == [
        "package_engine_constraints_missing"
    ]
    assert result.diagnostics[0].level == "warning"


@pytest.mark.parametrize(
    ("engines", "expected_code"),
    [
        (
            {"nodeflow": ">=99", "python": ">=3.11"},
            "package_nodeflow_engine_incompatible",
        ),
        (
            {"nodeflow": ">=0.1.0,<0.2.0", "python": "<3"},
            "package_python_engine_incompatible",
        ),
    ],
)
def test_incompatible_engine_blocks_entrypoint_import(
    tmp_path: Path,
    engines: dict[str, str],
    expected_code: str,
):
    package_dir = tmp_path / "incompatible"
    write_package_manifest(
        package_dir,
        package_id="example.incompatible",
        entrypoints=["node.py"],
        engines=engines,
    )
    (package_dir / "node.py").write_text(
        "raise RuntimeError('entrypoint must not be imported')\n",
        encoding="utf-8",
    )

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.list_node_types() == []
    assert result.packages[0].status == "failed"
    assert result.packages[0].compatibility == "incompatible"
    assert [diagnostic.code for diagnostic in result.diagnostics] == [expected_code]


@pytest.mark.parametrize(
    ("requirement", "expected_code"),
    [
        (
            "definitely-missing-nodeflow-distribution>=1",
            "package_python_dependency_missing",
        ),
        ("packaging<1", "package_python_dependency_incompatible"),
    ],
)
def test_unsatisfied_python_dependency_blocks_entrypoint_import(
    tmp_path: Path,
    requirement: str,
    expected_code: str,
):
    package_dir = tmp_path / "dependency"
    write_package_manifest(
        package_dir,
        package_id="example.dependency",
        entrypoints=["node.py"],
        python_dependencies=[requirement],
    )
    (package_dir / "node.py").write_text(
        "raise RuntimeError('entrypoint must not be imported')\n",
        encoding="utf-8",
    )

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.list_node_types() == []
    assert result.packages[0].status == "failed"
    assert [diagnostic.code for diagnostic in result.diagnostics] == [expected_code]


def test_satisfied_python_dependency_is_exposed_in_package_snapshot(tmp_path: Path):
    package_dir = tmp_path / "compatible"
    write_package_manifest(
        package_dir,
        package_id="example.compatible",
        entrypoints=["node.py"],
        python_dependencies=["packaging>=24"],
    )
    write_node_file(package_dir / "node.py", node_id="example.compatible.node")

    result = NodeRegistry(nodes_dir=tmp_path).scan()
    package = result.packages[0]

    assert package.status == "loaded"
    assert package.compatibility == "compatible"
    assert package.python_dependencies == ("packaging>=24",)
    assert package.to_api_dict()["compatibility"]["status"] == "compatible"


@pytest.mark.parametrize(
    "manifest_patch",
    [
        {"version": "not a version !"},
        {"engines": {"nodeflow": "not-a-range", "python": ">=3.11"}},
        {"engines": {"nodeflow": ">=0.1", "ruby": ">=3"}},
        {"pythonDependencies": ["not a valid requirement !!!"]},
        {"pythonDependencies": ["packaging>=24", "Packaging<30"]},
    ],
)
def test_invalid_compatibility_contract_is_a_manifest_diagnostic(
    tmp_path: Path,
    manifest_patch: dict[str, object],
):
    package_dir = tmp_path / "invalid-contract"
    write_package_manifest(
        package_dir,
        package_id="example.invalid_contract",
        entrypoints=["node.py"],
    )
    manifest_path = package_dir / "nodeflow-package.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.update(manifest_patch)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    write_node_file(package_dir / "node.py", node_id="example.invalid_contract.node")

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.list_node_types() == []
    assert [diagnostic.code for diagnostic in result.diagnostics] == [
        "package_manifest_invalid"
    ]


def test_disabled_package_is_visible_but_never_imported(tmp_path: Path):
    package_dir = tmp_path / "disabled"
    write_package_manifest(
        package_dir,
        package_id="example.disabled",
        entrypoints=["node.py"],
    )
    (package_dir / "node.py").write_text(
        "raise RuntimeError('disabled entrypoint must not be imported')\n",
        encoding="utf-8",
    )
    policies = {
        "example.disabled": NodePackagePolicy(
            package_id="example.disabled",
            enabled=False,
        )
    }

    registry = NodeRegistry(
        nodes_dir=tmp_path,
        package_policy_provider=lambda: policies,
    )
    result = registry.scan()

    assert registry.list_node_types() == []
    assert result.diagnostics == ()
    assert result.packages[0].status == "disabled"
    assert result.packages[0].enabled is False


def test_version_lock_mismatch_blocks_entrypoint_until_policy_changes(tmp_path: Path):
    package_dir = tmp_path / "locked"
    write_package_manifest(
        package_dir,
        package_id="example.locked",
        version="2.0.0",
        entrypoints=["node.py"],
    )
    write_node_file(package_dir / "node.py", node_id="example.locked.node")
    policies = {
        "example.locked": NodePackagePolicy(
            package_id="example.locked",
            locked_version="1.0.0",
        )
    }
    registry = NodeRegistry(
        nodes_dir=tmp_path,
        package_policy_provider=lambda: policies,
    )

    first = registry.scan()

    assert not registry.has("example.locked.node")
    assert first.packages[0].version_status == "mismatch"
    assert [diagnostic.code for diagnostic in first.diagnostics] == [
        "package_version_lock_mismatch"
    ]

    policies["example.locked"] = NodePackagePolicy(
        package_id="example.locked",
        locked_version="2.0",
    )

    assert registry.scan_if_changed() is True
    assert registry.has("example.locked.node")
    assert registry.scan_result.packages[0].version_status == "locked"
    assert registry.scan_if_changed() is False
