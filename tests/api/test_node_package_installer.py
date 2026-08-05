from __future__ import annotations

import io
import json
import subprocess
import sys
import threading
import time
import zipfile
from pathlib import Path

import pytest

from apps.api.nodeflow_api.node_package_installer import (
    NodePackageInstallError,
    NodePackageInstaller,
)
from apps.api.nodeflow_api.node_package_lifecycle import NodePackagePolicy
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import WorkflowReference


def package_archive(
    *,
    package_id: str = "example.tools",
    version: str = "1.0.0",
    node_id: str = "example.echo",
    activation_failure: bool = False,
    extra_files: dict[str, str] | None = None,
) -> bytes:
    manifest = {
        "id": package_id,
        "name": "Example tools",
        "version": version,
        "engines": {
            "nodeflow": ">=0.1.0,<0.2.0",
            "python": ">=3.11",
        },
        "pythonDependencies": [],
        "nodeEntrypoints": ["node.py"],
    }
    failure_guard = (
        """
from pathlib import Path
if "_installed" in Path(__file__).parts:
    raise RuntimeError("activation failed")
"""
        if activation_failure
        else ""
    )
    source = f"""
{failure_guard}
from nodeflow_sdk import BaseNode, NodeConfig, Output, node


@node(id="{node_id}", name="Echo", category="Test")
class EchoNode(BaseNode[NodeConfig]):
    outputs = {{"success": Output(description="Done")}}

    async def execute(self, ctx, inputs):
        return {{"success": {{"version": "{version}"}}}}
""".lstrip()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as package_zip:
        package_zip.writestr("example/nodeflow-package.json", json.dumps(manifest))
        package_zip.writestr("example/node.py", source)
        for path, content in (extra_files or {}).items():
            package_zip.writestr(path, content)
    return output.getvalue()


def create_installer(
    tmp_path: Path,
    *,
    policies: dict[str, NodePackagePolicy] | None = None,
    references: list[WorkflowReference] | None = None,
) -> tuple[NodePackageInstaller, NodeRegistry]:
    nodes_dir = tmp_path / "nodes"
    nodes_dir.mkdir()
    registry = NodeRegistry(
        nodes_dir=nodes_dir,
        package_policy_provider=(lambda: policies or {}),
    )
    registry.scan()
    installer = NodePackageInstaller(
        nodes_dir=nodes_dir,
        registry=registry,
        node_type_reference_provider=lambda node_type_ids: (
            list(references or []) if "example.echo" in node_type_ids else []
        ),
    )
    return installer, registry


class SimulatedProcessCrash(BaseException):
    pass


def test_installs_valid_archive_into_managed_slot(tmp_path: Path):
    installer, registry = create_installer(tmp_path)

    result = installer.install_archive(
        package_archive(),
        filename="example-tools.zip",
    )

    assert result.action == "installed"
    assert result.package.source == "installed"
    assert registry.has("example.echo")
    assert result.package.root_path == installer.package_install_path("example.tools")


def test_rejects_archive_path_traversal_without_writing_outside_staging(tmp_path: Path):
    installer, registry = create_installer(tmp_path)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as package_zip:
        package_zip.writestr("../escaped.py", "raise RuntimeError")

    with pytest.raises(NodePackageInstallError) as exc_info:
        installer.install_archive(output.getvalue(), filename="unsafe.zip")

    assert exc_info.value.code == "package_archive_path_invalid"
    assert not (tmp_path / "escaped.py").exists()
    assert registry.list_packages() == []


def test_rejects_files_outside_the_single_package_root(tmp_path: Path):
    installer, _ = create_installer(tmp_path)

    with pytest.raises(NodePackageInstallError) as exc_info:
        installer.install_archive(
            package_archive(extra_files={"readme.txt": "outside package"}),
            filename="bad-layout.zip",
        )

    assert exc_info.value.code == "package_archive_layout_invalid"


def test_upgrades_an_installed_package(tmp_path: Path):
    installer, registry = create_installer(tmp_path)
    installer.install_archive(package_archive(version="1.0.0"), filename="v1.zip")

    result = installer.install_archive(
        package_archive(version="2.0.0"),
        filename="v2.zip",
    )

    assert result.action == "upgraded"
    assert result.package.version == "2.0.0"
    assert registry.get("example.echo").package.version == "2.0.0"
    revisions = installer.list_revisions("example.tools")
    assert len(revisions) == 1
    assert revisions[0].version == "1.0.0"
    assert revisions[0].source_filename == "v1.zip"
    assert revisions[0].package_path.is_dir()


def test_activates_a_historical_revision_and_archives_the_current_version(tmp_path: Path):
    installer, registry = create_installer(tmp_path)
    installer.install_archive(package_archive(version="1.0.0"), filename="v1.zip")
    installer.install_archive(package_archive(version="2.0.0"), filename="v2.zip")
    revision = installer.list_revisions("example.tools")[0]

    result = installer.activate_revision("example.tools", revision.revision_id)

    assert result.action == "rolled_back"
    assert result.package.version == "1.0.0"
    assert registry.get("example.echo").package.version == "1.0.0"
    assert {item.version for item in installer.list_revisions("example.tools")} == {
        "1.0.0",
        "2.0.0",
    }


def test_rejects_a_modified_historical_revision(tmp_path: Path):
    installer, registry = create_installer(tmp_path)
    installer.install_archive(package_archive(version="1.0.0"), filename="v1.zip")
    installer.install_archive(package_archive(version="2.0.0"), filename="v2.zip")
    revision = installer.list_revisions("example.tools")[0]
    (revision.package_path / "node.py").write_text(
        "raise RuntimeError('modified history')\n",
        encoding="utf-8",
    )

    with pytest.raises(NodePackageInstallError) as exc_info:
        installer.activate_revision("example.tools", revision.revision_id)

    assert exc_info.value.code == "node_package_revision_corrupt"
    assert registry.get("example.echo").package.version == "2.0.0"


def test_version_lock_applies_to_historical_revision_activation(tmp_path: Path):
    policies: dict[str, NodePackagePolicy] = {}
    installer, registry = create_installer(tmp_path, policies=policies)
    installer.install_archive(package_archive(version="1.0.0"), filename="v1.zip")
    installer.install_archive(package_archive(version="2.0.0"), filename="v2.zip")
    revision = installer.list_revisions("example.tools")[0]
    policies["example.tools"] = NodePackagePolicy(
        package_id="example.tools",
        locked_version="2.0.0",
    )
    registry.scan()

    with pytest.raises(NodePackageInstallError) as exc_info:
        installer.activate_revision("example.tools", revision.revision_id)

    assert exc_info.value.code == "package_version_locked"
    assert registry.get("example.echo").package.version == "2.0.0"


def test_activation_failure_restores_previous_package(tmp_path: Path):
    installer, registry = create_installer(tmp_path)
    installer.install_archive(package_archive(version="1.0.0"), filename="v1.zip")

    with pytest.raises(NodePackageInstallError) as exc_info:
        installer.install_archive(
            package_archive(version="2.0.0", activation_failure=True),
            filename="broken-v2.zip",
        )

    assert exc_info.value.code == "package_activation_failed"
    assert registry.get("example.echo").package.version == "1.0.0"
    manifest = json.loads(
        (installer.package_install_path("example.tools") / "nodeflow-package.json").read_text(
            encoding="utf-8"
        )
    )
    assert manifest["version"] == "1.0.0"


def test_revision_archive_failure_restores_previous_package(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    installer, registry = create_installer(tmp_path)
    installer.install_archive(package_archive(version="1.0.0"), filename="v1.zip")
    write_json_atomic = installer._write_json_atomic

    def fail_revision_metadata(path: Path, value: dict[str, object]) -> None:
        if path.name == "metadata.json":
            raise OSError("history metadata unavailable")
        write_json_atomic(path, value)

    monkeypatch.setattr(installer, "_write_json_atomic", fail_revision_metadata)

    with pytest.raises(NodePackageInstallError) as exc_info:
        installer.install_archive(package_archive(version="2.0.0"), filename="v2.zip")

    assert exc_info.value.code == "package_activation_failed"
    assert registry.get("example.echo").package.version == "1.0.0"
    assert installer.list_revisions("example.tools") == []
    active_metadata = installer._read_active_metadata("example.tools")
    assert active_metadata is not None
    assert active_metadata["version"] == "1.0.0"


def test_rejects_downgrade_and_locked_version_change(tmp_path: Path):
    policies: dict[str, NodePackagePolicy] = {}
    installer, registry = create_installer(tmp_path, policies=policies)
    installer.install_archive(package_archive(version="2.0.0"), filename="v2.zip")

    with pytest.raises(NodePackageInstallError) as downgrade:
        installer.install_archive(package_archive(version="1.0.0"), filename="v1.zip")
    assert downgrade.value.code == "package_downgrade_forbidden"

    policies["example.tools"] = NodePackagePolicy(
        package_id="example.tools",
        locked_version="2.0.0",
    )
    registry.scan()
    with pytest.raises(NodePackageInstallError) as locked:
        installer.install_archive(package_archive(version="3.0.0"), filename="v3.zip")
    assert locked.value.code == "package_version_locked"
    assert registry.get("example.echo").package.version == "2.0.0"


def test_rejects_replacing_a_workspace_package(tmp_path: Path):
    installer, registry = create_installer(tmp_path)
    workspace_package = tmp_path / "nodes" / "workspace"
    workspace_package.mkdir()
    archive = package_archive()
    with zipfile.ZipFile(io.BytesIO(archive)) as package_zip:
        for member in package_zip.infolist():
            if member.is_dir():
                continue
            relative = Path(member.filename).relative_to("example")
            target = workspace_package / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(package_zip.read(member))
    registry.scan()

    with pytest.raises(NodePackageInstallError) as exc_info:
        installer.install_archive(
            package_archive(version="2.0.0"),
            filename="v2.zip",
        )

    assert exc_info.value.code == "workspace_package_replace_forbidden"
    assert registry.get("example.echo").package.source == "workspace"


def test_upgrade_cannot_remove_a_referenced_node(tmp_path: Path):
    reference = WorkflowReference(
        workflow_id="wf_one",
        workflow_name="Referenced workflow",
        node_id="echo",
        node_label="Echo",
    )
    installer, registry = create_installer(tmp_path, references=[reference])
    installer.install_archive(package_archive(), filename="v1.zip")

    with pytest.raises(NodePackageInstallError) as exc_info:
        installer.install_archive(
            package_archive(version="2.0.0", node_id="example.changed"),
            filename="v2.zip",
        )

    assert exc_info.value.code == "node_package_referenced"
    assert exc_info.value.to_detail()["references"] == [reference.model_dump()]
    assert registry.has("example.echo")
    assert not registry.has("example.changed")


def test_uninstalls_managed_package_and_blocks_referenced_package(tmp_path: Path):
    references: list[WorkflowReference] = []
    installer, registry = create_installer(tmp_path, references=references)
    installer.install_archive(package_archive(), filename="v1.zip")
    reference = WorkflowReference(
        workflow_id="wf_one",
        workflow_name="Referenced workflow",
        node_id="echo",
        node_label="Echo",
    )
    references.append(reference)

    with pytest.raises(NodePackageInstallError) as referenced:
        installer.uninstall("example.tools")
    assert referenced.value.code == "node_package_referenced"
    assert registry.has("example.echo")

    references.clear()
    installer.install_archive(package_archive(version="2.0.0"), filename="v2.zip")
    assert installer.list_revisions("example.tools")
    assert not (installer.backup_root / installer.package_install_path("example.tools").name).exists()
    scan = installer.uninstall("example.tools")

    assert scan.packages == ()
    assert not registry.has("example.echo")
    assert not installer.package_install_path("example.tools").exists()
    assert not installer._package_history_dir("example.tools").exists()
    assert not (installer.backup_root / installer.package_install_path("example.tools").name).exists()
    assert not installer._active_metadata_path("example.tools").exists()


def test_registry_scan_waits_for_an_active_package_mutation(tmp_path: Path):
    _, registry = create_installer(tmp_path)
    started = threading.Event()
    completed = threading.Event()

    def scan_registry() -> None:
        started.set()
        registry.scan()
        completed.set()

    with registry.mutation_lock():
        thread = threading.Thread(target=scan_registry)
        thread.start()
        assert started.wait(timeout=1)
        assert completed.wait(timeout=0.05) is False

    assert completed.wait(timeout=1)
    thread.join(timeout=1)


def test_cross_process_lease_rejects_a_second_package_mutation(tmp_path: Path):
    installer, registry = create_installer(tmp_path)
    installer.mutation_lease.timeout_seconds = 0.1
    ready_path = tmp_path / "lease-ready"
    project_root = Path(__file__).resolve().parents[2]
    script = f"""
import time
from pathlib import Path
from apps.api.nodeflow_api.node_package_lease import NodePackageMutationLease

lease = NodePackageMutationLease(Path({str(installer.mutation_lease.path)!r}))
with lease.acquire({{"operation": "external-test"}}):
    Path({str(ready_path)!r}).write_text("ready", encoding="utf-8")
    time.sleep(10)
"""
    process = subprocess.Popen([sys.executable, "-c", script], cwd=project_root)
    try:
        deadline = time.monotonic() + 5
        while not ready_path.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        assert ready_path.exists()

        with pytest.raises(NodePackageInstallError) as exc_info:
            installer.install_archive(package_archive(), filename="blocked.zip")

        assert exc_info.value.code == "node_package_mutation_busy"
        assert exc_info.value.status_code == 409
        assert exc_info.value.context["owner"]["operation"] == "external-test"
        assert not registry.has("example.echo")
    finally:
        process.terminate()
        process.wait(timeout=5)

    result = installer.install_archive(package_archive(), filename="after-release.zip")
    assert result.package.version == "1.0.0"


def test_recovers_an_interrupted_upgrade_to_the_previous_version(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    installer, _ = create_installer(tmp_path)
    installer.install_archive(package_archive(version="1.0.0"), filename="v1.zip")

    def crash_before_commit(package_id: str, metadata: dict[str, object]) -> None:
        raise SimulatedProcessCrash

    monkeypatch.setattr(installer, "_write_active_metadata", crash_before_commit)

    with pytest.raises(SimulatedProcessCrash):
        installer.install_archive(package_archive(version="2.0.0"), filename="v2.zip")

    assert list(installer.transaction_root.glob("tx_*.json"))
    interrupted_manifest = json.loads(
        (installer.package_install_path("example.tools") / "nodeflow-package.json").read_text(
            encoding="utf-8"
        )
    )
    assert interrupted_manifest["version"] == "2.0.0"

    recovered_registry = NodeRegistry(nodes_dir=tmp_path / "nodes")
    recovered_installer = NodePackageInstaller(
        nodes_dir=tmp_path / "nodes",
        registry=recovered_registry,
    )
    events = recovered_installer.recover_incomplete_transactions()

    assert len(events) == 1
    assert events[0].operation == "activate"
    assert events[0].action == "rolled_back"
    assert recovered_registry.get("example.echo").package.version == "1.0.0"
    assert recovered_installer.list_revisions("example.tools") == []
    assert not list(recovered_installer.transaction_root.glob("tx_*.json"))
    assert not list(recovered_installer.backup_root.rglob("*"))
    assert recovered_installer._read_active_metadata("example.tools")["version"] == "1.0.0"


def test_recovers_an_interrupted_uninstall(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    installer, registry = create_installer(tmp_path)
    installer.install_archive(package_archive(), filename="v1.zip")

    def crash_after_package_move():
        raise SimulatedProcessCrash

    monkeypatch.setattr(registry, "scan", crash_after_package_move)

    with pytest.raises(SimulatedProcessCrash):
        installer.uninstall("example.tools")

    assert not installer.package_install_path("example.tools").exists()
    assert list(installer.transaction_root.glob("tx_*.json"))

    recovered_registry = NodeRegistry(nodes_dir=tmp_path / "nodes")
    recovered_installer = NodePackageInstaller(
        nodes_dir=tmp_path / "nodes",
        registry=recovered_registry,
    )
    events = recovered_installer.recover_incomplete_transactions()

    assert len(events) == 1
    assert events[0].operation == "uninstall"
    assert events[0].action == "rolled_back"
    assert recovered_registry.has("example.echo")
    assert recovered_installer.package_install_path("example.tools").exists()
    assert not list(recovered_installer.transaction_root.glob("tx_*.json"))


def test_recovery_finishes_cleanup_for_an_already_committed_upgrade(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    installer, registry = create_installer(tmp_path)
    installer.install_archive(package_archive(version="1.0.0"), filename="v1.zip")
    monkeypatch.setattr(
        installer,
        "_complete_committed_transaction",
        lambda transaction: None,
    )

    result = installer.install_archive(package_archive(version="2.0.0"), filename="v2.zip")

    assert result.package.version == "2.0.0"
    assert registry.get("example.echo").package.version == "2.0.0"
    assert list(installer.transaction_root.glob("tx_*.json"))
    assert list(installer.backup_root.rglob("nodeflow-package.json"))

    recovered_registry = NodeRegistry(nodes_dir=tmp_path / "nodes")
    recovered_installer = NodePackageInstaller(
        nodes_dir=tmp_path / "nodes",
        registry=recovered_registry,
    )
    events = recovered_installer.recover_incomplete_transactions()

    assert len(events) == 1
    assert events[0].operation == "activate"
    assert events[0].action == "completed"
    assert recovered_registry.get("example.echo").package.version == "2.0.0"
    assert [revision.version for revision in recovered_installer.list_revisions("example.tools")] == [
        "1.0.0"
    ]
    assert not list(recovered_installer.transaction_root.glob("tx_*.json"))
    assert not list(recovered_installer.backup_root.rglob("nodeflow-package.json"))


def test_another_process_registry_observes_a_committed_package_change(tmp_path: Path):
    installer, registry = create_installer(tmp_path)
    second_registry = NodeRegistry(nodes_dir=tmp_path / "nodes")
    second_installer = NodePackageInstaller(
        nodes_dir=tmp_path / "nodes",
        registry=second_registry,
    )
    second_installer.recover_incomplete_transactions()
    assert not second_registry.has("example.echo")

    installer.install_archive(package_archive(), filename="v1.zip")

    assert registry.has("example.echo")
    assert second_installer.scan_registry_if_changed(timeout_seconds=1.0) is True
    assert second_registry.has("example.echo")
