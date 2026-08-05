import json
from pathlib import Path

import pytest

from apps.api.nodeflow_api.node_registry import NodeRegistry
from nodeflow_sdk.scaffold import PackageScaffoldOptions, main, scaffold_package


def test_scaffold_package_creates_a_loadable_node_package(tmp_path: Path):
    target = tmp_path / "acme-tools"

    result = scaffold_package(
        PackageScaffoldOptions(
            target=target,
            package_id="acme.tools",
            package_name="Acme Tools",
            node_id="acme.echo",
            node_name="Echo",
            category="Custom",
        )
    )

    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert manifest == {
        "id": "acme.tools",
        "name": "Acme Tools",
        "version": "0.1.0",
        "description": "Custom Node Flow nodes.",
        "engines": {
            "nodeflow": ">=0.1.0,<0.2.0",
            "python": ">=3.11",
        },
        "pythonDependencies": [],
        "nodeEntrypoints": ["echo.py"],
    }
    assert "@node(" in result.node_path.read_text(encoding="utf-8")

    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()

    assert registry.get("acme.echo").to_api_dict()["package"] == {
        "id": "acme.tools",
        "name": "Acme Tools",
        "version": "0.1.0",
    }


def test_scaffold_package_refuses_to_overwrite_an_existing_directory(tmp_path: Path):
    target = tmp_path / "existing"
    target.mkdir()

    with pytest.raises(FileExistsError, match="already exists"):
        scaffold_package(
            PackageScaffoldOptions(
                target=target,
                package_id="acme.tools",
                package_name="Acme Tools",
                node_id="acme.echo",
                node_name="Echo",
            )
        )


def test_scaffold_command_creates_a_package_and_reports_its_paths(tmp_path: Path, capsys):
    target = tmp_path / "cli-tools"

    exit_code = main(
        [
            str(target),
            "--package-id",
            "acme.tools",
            "--package-name",
            "Acme Tools",
            "--node-id",
            "acme.echo",
            "--node-name",
            "Echo",
        ]
    )

    assert exit_code == 0
    assert "Created Node Flow package" in capsys.readouterr().out
    assert (target / "nodeflow-package.json").is_file()
    assert (target / "echo.py").is_file()


@pytest.mark.parametrize("package_id,node_id", [("acme", "acme.echo"), ("acme.tools", "echo")])
def test_scaffold_package_requires_namespaced_package_and_node_ids(
    tmp_path: Path, package_id: str, node_id: str
):
    with pytest.raises(ValueError, match="must use a namespace"):
        scaffold_package(
            PackageScaffoldOptions(
                target=tmp_path / "acme-tools",
                package_id=package_id,
                package_name="Acme Tools",
                node_id=node_id,
                node_name="Echo",
            )
        )
