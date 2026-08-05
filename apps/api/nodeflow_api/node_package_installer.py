from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
import threading
import zipfile
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Callable, Iterator, Literal
from uuid import uuid4

from packaging.version import Version

from .node_package_lease import NodePackageLeaseBusyError, NodePackageMutationLease
from .node_package_lifecycle import NodePackagePolicy
from .node_registry import NodePackageInfo, NodeRegistry, NodeRegistryScanResult
from .schemas import WorkflowReference


INSTALLED_PACKAGES_DIRNAME = "_installed"
MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
MAX_EXTRACTED_BYTES = 50 * 1024 * 1024
MAX_ARCHIVE_FILES = 500
MAX_PACKAGE_REVISIONS = 10
TRANSACTION_STATES = frozenset(
    {"prepared", "old_moved", "candidate_active", "revision_archived", "committed"}
)


class NodePackageInstallError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 422,
        context: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.context = context or {}

    def to_detail(self) -> dict[str, object]:
        return {"code": self.code, "message": self.message, **self.context}


@dataclass(frozen=True)
class NodePackageInstallResult:
    action: Literal["installed", "upgraded", "reinstalled", "rolled_back"]
    package: NodePackageInfo
    scan: NodeRegistryScanResult

    def to_api_dict(self) -> dict[str, object]:
        return {
            "action": self.action,
            "package": self.package.to_api_dict(),
            "scan": self.scan.to_api_dict(),
        }


@dataclass(frozen=True)
class NodePackageRevision:
    revision_id: str
    package_id: str
    version: str
    source_filename: str | None
    installed_at: str | None
    archived_at: str
    checksum: str
    package_path: Path

    def to_api_dict(self) -> dict[str, str | None]:
        return {
            "revisionId": self.revision_id,
            "packageId": self.package_id,
            "version": self.version,
            "sourceFilename": self.source_filename,
            "installedAt": self.installed_at,
            "archivedAt": self.archived_at,
            "checksum": self.checksum,
        }


@dataclass(frozen=True)
class NodePackageRecoveryEvent:
    transaction_id: str
    package_id: str
    operation: Literal["activate", "uninstall"]
    action: Literal["rolled_back", "completed"]
    recovered_at: str

    def to_api_dict(self) -> dict[str, str]:
        return {
            "transactionId": self.transaction_id,
            "packageId": self.package_id,
            "operation": self.operation,
            "action": self.action,
            "recoveredAt": self.recovered_at,
        }


@dataclass
class _NodePackageTransaction:
    path: Path
    data: dict[str, object]


class NodePackageInstaller:
    """Install trusted local ZIP packages with staging and activation rollback."""

    def __init__(
        self,
        *,
        nodes_dir: Path,
        registry: NodeRegistry,
        node_type_reference_provider: (
            Callable[[tuple[str, ...]], list[WorkflowReference]] | None
        ) = None,
    ) -> None:
        self.nodes_dir = nodes_dir.resolve()
        self.registry = registry
        self.install_root = self.nodes_dir / INSTALLED_PACKAGES_DIRNAME
        self.state_root = self.nodes_dir.parent / ".nodeflow-packages"
        self.staging_root = self.state_root / "staging"
        self.backup_root = self.state_root / "backups"
        self.history_root = self.state_root / "history"
        self.active_metadata_root = self.state_root / "active"
        self.transaction_root = self.state_root / "transactions"
        self.mutation_lease = NodePackageMutationLease(
            self.state_root / "mutation.lock"
        )
        self.node_type_reference_provider = node_type_reference_provider
        self._lock = threading.RLock()
        self._recovery_events: list[NodePackageRecoveryEvent] = []

    def recover_incomplete_transactions(self) -> list[NodePackageRecoveryEvent]:
        with self._mutation_scope(
            operation="recovery",
            timeout_seconds=max(self.mutation_lease.timeout_seconds, 10.0),
            recover_first=False,
        ):
            self._recovery_events.extend(self._recover_transactions_locked())
            self._cleanup_staging_root()
            self.registry.scan()
        return list(self._recovery_events)

    def recovery_events(self) -> list[NodePackageRecoveryEvent]:
        with self._lock:
            return list(self._recovery_events)

    @contextmanager
    def mutation_guard(
        self,
        *,
        operation: str,
        package_id: str | None = None,
        timeout_seconds: float | None = None,
    ) -> Iterator[None]:
        with self._mutation_scope(
            operation=operation,
            package_id=package_id,
            timeout_seconds=timeout_seconds,
        ):
            yield

    def scan_registry(self) -> NodeRegistryScanResult:
        with self._mutation_scope(operation="scan"):
            return self.registry.scan()

    def scan_registry_if_changed(self, *, timeout_seconds: float = 30.0) -> bool:
        with self._mutation_scope(
            operation="scan_if_changed",
            timeout_seconds=timeout_seconds,
        ):
            return self.registry.scan_if_changed()

    def install_archive(
        self,
        archive: bytes,
        *,
        filename: str,
    ) -> NodePackageInstallResult:
        if not filename.lower().endswith(".zip"):
            raise NodePackageInstallError(
                "package_archive_type_invalid",
                "节点包必须是 ZIP 文件。",
            )
        if not archive:
            raise NodePackageInstallError(
                "package_archive_empty",
                "节点包文件为空。",
            )
        if len(archive) > MAX_ARCHIVE_BYTES:
            raise NodePackageInstallError(
                "package_archive_too_large",
                f"节点包 ZIP 不能超过 {MAX_ARCHIVE_BYTES // (1024 * 1024)} MB。",
                status_code=413,
            )

        with self._mutation_scope(operation="install", filename=filename):
            return self._install_archive_locked(archive, filename=filename)

    def uninstall(self, package_id: str) -> NodeRegistryScanResult:
        with self._mutation_scope(operation="uninstall", package_id=package_id):
            node_package = self._find_package(package_id)
            if node_package is None:
                raise NodePackageInstallError(
                    "node_package_not_found",
                    "节点包不存在。",
                    status_code=404,
                )
            if node_package.source != "installed":
                raise NodePackageInstallError(
                    "node_package_not_install_managed",
                    "只能卸载通过节点包管理器安装的包。",
                    status_code=409,
                )
            self._require_unreferenced(
                self._package_node_ids(node_package),
                message="仍有工作流使用该节点包，请先移除相关节点。",
            )

            destination = self.package_install_path(package_id)
            if node_package.root_path.resolve() != destination.resolve():
                raise NodePackageInstallError(
                    "node_package_install_path_mismatch",
                    "节点包安装位置与管理记录不一致，已停止卸载。",
                    status_code=409,
                )
            backup = self._backup_path(package_id, node_package.version)
            backup.parent.mkdir(parents=True, exist_ok=True)
            transaction = self._begin_transaction(
                operation="uninstall",
                package_id=package_id,
                destination=destination,
                backup=backup,
                old_active_metadata=self._read_active_metadata(package_id),
                target_version=None,
            )
            try:
                os.replace(destination, backup)
                self._update_transaction(transaction, state="old_moved")
                scan = self.registry.scan()
                if self._find_package(package_id) is not None:
                    raise RuntimeError("卸载后节点包仍被注册表发现")
                self._update_transaction(transaction, state="committed")
            except Exception as exc:
                self._rollback_transaction(transaction)
                self.registry.scan()
                raise NodePackageInstallError(
                    "node_package_uninstall_failed",
                    f"节点包卸载失败，已恢复原版本：{exc}",
                    status_code=500,
                ) from exc
            self._complete_committed_transaction(transaction)
            return scan

    def list_revisions(self, package_id: str) -> list[NodePackageRevision]:
        with self._mutation_scope(operation="history_read", package_id=package_id):
            node_package = self._require_installed_package(package_id)
            del node_package
            return self._list_revisions_locked(package_id)

    def activate_revision(
        self,
        package_id: str,
        revision_id: str,
    ) -> NodePackageInstallResult:
        if not re.fullmatch(r"rev_[0-9a-f]{32}", revision_id):
            raise NodePackageInstallError(
                "node_package_revision_id_invalid",
                "节点包历史修订 ID 无效。",
                status_code=404,
            )
        with self._mutation_scope(operation="activate_revision", package_id=package_id):
            self._require_installed_package(package_id)
            revision_dir = self._package_history_dir(package_id) / revision_id
            if not revision_dir.is_dir():
                raise NodePackageInstallError(
                    "node_package_revision_not_found",
                    "节点包历史版本不存在。",
                    status_code=404,
                )
            revision = self._read_revision(revision_dir)
            if revision.package_id != package_id:
                raise NodePackageInstallError(
                    "node_package_revision_mismatch",
                    "历史版本不属于当前节点包。",
                    status_code=409,
                )
            if self._directory_checksum(revision.package_path) != revision.checksum:
                raise NodePackageInstallError(
                    "node_package_revision_corrupt",
                    "节点包历史版本内容已变化，不能恢复。",
                    status_code=409,
                )
            self.staging_root.mkdir(parents=True, exist_ok=True)
            temporary_root = Path(
                tempfile.mkdtemp(prefix="rollback-", dir=self.staging_root)
            ).resolve()
            try:
                candidate_root = temporary_root / "candidate"
                shutil.copytree(revision.package_path, candidate_root)
                staged_root, staged_package = self._inspect_staged_package(temporary_root)
                if staged_package.id != package_id:
                    raise NodePackageInstallError(
                        "node_package_revision_mismatch",
                        "历史版本中的包 ID 与当前节点包不一致。",
                        status_code=409,
                    )
                self._validate_install_transition(
                    staged_package,
                    allow_downgrade=True,
                )
                self._remove_bytecode_cache(staged_root)
                return self._activate_package(
                    staged_root,
                    staged_package=staged_package,
                    filename=revision.source_filename or f"历史版本 v{revision.version}",
                    action_override="rolled_back",
                )
            finally:
                if temporary_root.exists():
                    self._remove_tree(temporary_root, allowed_root=self.staging_root)

    def package_install_path(self, package_id: str) -> Path:
        safe_id = re.sub(r"[^A-Za-z0-9._-]+", "-", package_id).strip("._-")
        safe_id = (safe_id or "package")[:80]
        digest = hashlib.sha256(package_id.encode("utf-8")).hexdigest()[:8]
        return self.install_root / f"{safe_id}-{digest}"

    def _install_archive_locked(
        self,
        archive: bytes,
        *,
        filename: str,
    ) -> NodePackageInstallResult:
        self.staging_root.mkdir(parents=True, exist_ok=True)
        temporary_root = Path(
            tempfile.mkdtemp(prefix="install-", dir=self.staging_root)
        ).resolve()
        try:
            extraction_root = temporary_root / "archive"
            extraction_root.mkdir()
            self._extract_archive(archive, extraction_root)
            package_root, staged_package = self._inspect_staged_package(extraction_root)
            self._validate_install_transition(staged_package)
            self._remove_bytecode_cache(package_root)
            return self._activate_package(
                package_root,
                staged_package=staged_package,
                filename=filename,
            )
        finally:
            if temporary_root.exists():
                self._remove_tree(temporary_root, allowed_root=self.staging_root)

    def _extract_archive(self, archive: bytes, extraction_root: Path) -> None:
        archive_path = extraction_root.parent / "package.zip"
        archive_path.write_bytes(archive)
        try:
            with zipfile.ZipFile(archive_path) as package_zip:
                members = package_zip.infolist()
                files = [member for member in members if not member.is_dir()]
                if len(files) > MAX_ARCHIVE_FILES:
                    raise NodePackageInstallError(
                        "package_archive_too_many_files",
                        f"节点包最多包含 {MAX_ARCHIVE_FILES} 个文件。",
                    )
                if sum(member.file_size for member in files) > MAX_EXTRACTED_BYTES:
                    raise NodePackageInstallError(
                        "package_archive_expanded_too_large",
                        f"节点包解压后不能超过 {MAX_EXTRACTED_BYTES // (1024 * 1024)} MB。",
                    )

                seen_paths: set[str] = set()
                for member in members:
                    relative_path = self._safe_archive_path(member)
                    path_key = relative_path.as_posix().casefold()
                    if path_key in seen_paths:
                        raise NodePackageInstallError(
                            "package_archive_path_duplicate",
                            f"节点包包含重复路径：{relative_path.as_posix()}。",
                        )
                    seen_paths.add(path_key)
                    target = (extraction_root / Path(*relative_path.parts)).resolve()
                    if not target.is_relative_to(extraction_root):
                        raise NodePackageInstallError(
                            "package_archive_path_invalid",
                            "节点包包含越界路径。",
                        )
                    if member.is_dir():
                        target.mkdir(parents=True, exist_ok=True)
                        continue
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with package_zip.open(member) as source, target.open("wb") as output:
                        shutil.copyfileobj(source, output)
        except zipfile.BadZipFile as exc:
            raise NodePackageInstallError(
                "package_archive_invalid",
                "节点包不是有效的 ZIP 文件。",
            ) from exc
        finally:
            archive_path.unlink(missing_ok=True)

    def _safe_archive_path(self, member: zipfile.ZipInfo) -> PurePosixPath:
        if "\\" in member.filename:
            raise NodePackageInstallError(
                "package_archive_path_invalid",
                f"节点包路径必须使用正斜杠：{member.filename}。",
            )
        path = PurePosixPath(member.filename)
        if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
            raise NodePackageInstallError(
                "package_archive_path_invalid",
                f"节点包包含无效路径：{member.filename}。",
            )
        unix_mode = member.external_attr >> 16
        if stat.S_ISLNK(unix_mode):
            raise NodePackageInstallError(
                "package_archive_symlink_forbidden",
                f"节点包不能包含符号链接：{member.filename}。",
            )
        return path

    def _inspect_staged_package(
        self,
        extraction_root: Path,
    ) -> tuple[Path, NodePackageInfo]:
        manifests = sorted(extraction_root.rglob("nodeflow-package.json"))
        if len(manifests) != 1:
            raise NodePackageInstallError(
                "package_archive_manifest_count_invalid",
                "节点包 ZIP 必须且只能包含一个 nodeflow-package.json。",
            )
        package_root = manifests[0].parent.resolve()
        outside_files = [
            path
            for path in extraction_root.rglob("*")
            if path.is_file() and not path.resolve().is_relative_to(package_root)
        ]
        if outside_files:
            raise NodePackageInstallError(
                "package_archive_layout_invalid",
                "节点包清单之外不能包含其他文件。",
            )

        staged_registry = NodeRegistry(nodes_dir=extraction_root)
        scan = staged_registry.scan()
        if len(scan.packages) != 1:
            message = (
                scan.diagnostics[0].message
                if scan.diagnostics
                else "节点包预检没有发现有效清单。"
            )
            raise NodePackageInstallError(
                "package_preflight_failed",
                message,
            )
        node_package = scan.packages[0]
        errors = [issue for issue in scan.diagnostics if issue.level == "error"]
        if node_package.status != "loaded" or errors:
            message = errors[0].message if errors else "节点包必须完整加载后才能安装。"
            raise NodePackageInstallError(
                "package_preflight_failed",
                message,
            )
        if scan.legacy_node_count:
            raise NodePackageInstallError(
                "package_archive_layout_invalid",
                "节点包 ZIP 中不能包含清单之外的旧式节点脚本。",
            )
        if node_package.id == "nodeflow.builtin":
            raise NodePackageInstallError(
                "builtin_package_install_forbidden",
                "不能通过本地安装覆盖系统内置节点包。",
                status_code=409,
            )
        return package_root, node_package

    def _validate_install_transition(
        self,
        staged_package: NodePackageInfo,
        *,
        allow_downgrade: bool = False,
    ) -> None:
        existing = self._find_package(staged_package.id)
        destination = self.package_install_path(staged_package.id)
        other_node_ids = {
            node_type.id
            for node_type in self.registry.list_node_types()
            if node_type.package is None or node_type.package.id != staged_package.id
        }
        duplicate_node_ids = sorted(other_node_ids.intersection(staged_package.node_ids))
        if duplicate_node_ids:
            raise NodePackageInstallError(
                "package_node_id_conflict",
                f"节点类型 ID 已被其他节点包使用：{', '.join(duplicate_node_ids)}。",
                status_code=409,
            )
        other_credential_type_ids = {
            credential_type_id
            for node_package in self.registry.list_packages()
            if node_package.id != staged_package.id
            for credential_type_id in node_package.credential_type_ids
        }
        duplicate_credential_type_ids = sorted(
            other_credential_type_ids.intersection(staged_package.credential_type_ids)
        )
        if duplicate_credential_type_ids:
            raise NodePackageInstallError(
                "package_credential_type_id_conflict",
                (
                    "凭据类型 ID 已被其他节点包使用："
                    f"{', '.join(duplicate_credential_type_ids)}。"
                ),
                status_code=409,
            )
        if existing is not None:
            if existing.source != "installed" or existing.root_path.resolve() != destination.resolve():
                raise NodePackageInstallError(
                    "workspace_package_replace_forbidden",
                    "同 ID 节点包来自工作区目录，安装器不会覆盖手写源码。",
                    status_code=409,
                )
            if not allow_downgrade and Version(staged_package.version) < Version(existing.version):
                raise NodePackageInstallError(
                    "package_downgrade_forbidden",
                    (
                        f"不能从 v{existing.version} 降级到 v{staged_package.version}；"
                        "请使用明确的历史版本恢复流程。"
                    ),
                    status_code=409,
                )
            removed_node_ids = tuple(
                sorted(set(self._package_node_ids(existing)) - set(staged_package.node_ids))
            )
            self._require_unreferenced(
                removed_node_ids,
                message="新版本移除了仍被工作流使用的节点，请先调整相关工作流。",
            )

        policy = self._package_policy(staged_package.id)
        if (
            policy.locked_version is not None
            and Version(policy.locked_version) != Version(staged_package.version)
        ):
            raise NodePackageInstallError(
                "package_version_locked",
                (
                    f"节点包已锁定到 v{policy.locked_version}，"
                    f"不能安装 v{staged_package.version}。请先解除版本锁定。"
                ),
                status_code=409,
            )
        if destination.exists() and existing is None:
            raise NodePackageInstallError(
                "package_install_path_occupied",
                "节点包安装目录已被未知文件占用，已停止安装。",
                status_code=409,
            )

    def _activate_package(
        self,
        package_root: Path,
        *,
        staged_package: NodePackageInfo,
        filename: str,
        action_override: Literal["rolled_back"] | None = None,
    ) -> NodePackageInstallResult:
        existing = self._find_package(staged_package.id)
        destination = self.package_install_path(staged_package.id)
        old_active_metadata = self._read_active_metadata(staged_package.id)
        destination.parent.mkdir(parents=True, exist_ok=True)
        backup: Path | None = None
        if destination.exists():
            backup = self._backup_path(staged_package.id, existing.version if existing else "unknown")
            backup.parent.mkdir(parents=True, exist_ok=True)
        transaction = self._begin_transaction(
            operation="activate",
            package_id=staged_package.id,
            destination=destination,
            backup=backup,
            old_active_metadata=old_active_metadata,
            target_version=staged_package.version,
        )

        try:
            if backup is not None:
                os.replace(destination, backup)
                self._update_transaction(transaction, state="old_moved")
            os.replace(package_root, destination)
            self._update_transaction(transaction, state="candidate_active")
            scan = self.registry.scan()
            activated = self._find_package(staged_package.id)
            package_errors = [
                issue
                for issue in scan.diagnostics
                if issue.level == "error" and issue.package_id == staged_package.id
            ]
            if (
                activated is None
                or activated.status != "loaded"
                or Version(activated.version) != Version(staged_package.version)
                or package_errors
            ):
                message = (
                    package_errors[0].message
                    if package_errors
                    else "节点包激活后未能完整加载。"
                )
                raise RuntimeError(message)
            if backup is not None and backup.exists() and existing is not None:
                revision_id = f"rev_{uuid4().hex}"
                self._update_transaction(
                    transaction,
                    archivedRevisionId=revision_id,
                )
                self._archive_previous_active(
                    backup,
                    node_package=existing,
                    active_metadata=old_active_metadata,
                    revision_id=revision_id,
                )
                self._update_transaction(transaction, state="revision_archived")
            self._write_active_metadata(
                staged_package.id,
                {
                    "packageId": staged_package.id,
                    "version": staged_package.version,
                    "sourceFilename": filename,
                    "installedAt": self._now(),
                    "checksum": self._directory_checksum(destination),
                },
            )
            self._update_transaction(transaction, state="committed")
        except Exception as exc:
            self._rollback_transaction(transaction)
            self.registry.scan()
            raise NodePackageInstallError(
                "package_activation_failed",
                f"节点包激活失败，已恢复原版本：{exc}",
                status_code=409,
            ) from exc

        self._complete_committed_transaction(transaction)
        self._prune_revisions(staged_package.id)
        action: Literal["installed", "upgraded", "reinstalled", "rolled_back"]
        if action_override is not None:
            action = action_override
        elif existing is None:
            action = "installed"
        elif Version(staged_package.version) > Version(existing.version):
            action = "upgraded"
        else:
            action = "reinstalled"
        return NodePackageInstallResult(action=action, package=activated, scan=scan)

    @contextmanager
    def _mutation_scope(
        self,
        *,
        operation: str,
        package_id: str | None = None,
        filename: str | None = None,
        timeout_seconds: float | None = None,
        recover_first: bool = True,
    ) -> Iterator[None]:
        owner = {"operation": operation}
        if package_id is not None:
            owner["packageId"] = package_id
        if filename is not None:
            owner["filename"] = filename
        try:
            with self._lock, self.mutation_lease.acquire(
                owner,
                timeout_seconds=timeout_seconds,
            ), self.registry.mutation_lock():
                if recover_first:
                    recovered = self._recover_transactions_locked()
                    if recovered:
                        self._recovery_events.extend(recovered)
                        self.registry.scan()
                yield
        except NodePackageLeaseBusyError as exc:
            context: dict[str, object] = {}
            if exc.owner:
                context["owner"] = exc.owner
            raise NodePackageInstallError(
                "node_package_mutation_busy",
                "另一个服务进程正在变更节点包，请稍后重试。",
                status_code=409,
                context=context,
            ) from exc

    def _begin_transaction(
        self,
        *,
        operation: Literal["activate", "uninstall"],
        package_id: str,
        destination: Path,
        backup: Path | None,
        old_active_metadata: dict[str, object] | None,
        target_version: str | None,
    ) -> _NodePackageTransaction:
        if destination.resolve() != self.package_install_path(package_id).resolve():
            raise RuntimeError("transaction destination does not match package slot")
        transaction_id = f"tx_{uuid4().hex}"
        now = self._now()
        data: dict[str, object] = {
            "transactionId": transaction_id,
            "operation": operation,
            "packageId": package_id,
            "state": "prepared",
            "targetVersion": target_version,
            "backupRelative": (
                backup.resolve().relative_to(self.backup_root.resolve()).as_posix()
                if backup is not None
                else None
            ),
            "oldActiveMetadata": old_active_metadata,
            "archivedRevisionId": None,
            "createdAt": now,
            "updatedAt": now,
        }
        transaction = _NodePackageTransaction(
            path=self.transaction_root / f"{transaction_id}.json",
            data=data,
        )
        self._write_transaction(transaction)
        return transaction

    def _update_transaction(
        self,
        transaction: _NodePackageTransaction,
        **changes: object,
    ) -> None:
        transaction.data.update(changes)
        transaction.data["updatedAt"] = self._now()
        self._write_transaction(transaction)

    def _write_transaction(self, transaction: _NodePackageTransaction) -> None:
        self._write_json_atomic(transaction.path, transaction.data)

    def _read_transaction(self, path: Path) -> _NodePackageTransaction:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                raise ValueError("transaction is not an object")
            transaction_id = raw.get("transactionId")
            package_id = raw.get("packageId")
            operation = raw.get("operation")
            state = raw.get("state")
            if (
                not isinstance(transaction_id, str)
                or transaction_id != path.stem
                or not re.fullmatch(r"tx_[0-9a-f]{32}", transaction_id)
                or not isinstance(package_id, str)
                or not package_id
                or operation not in {"activate", "uninstall"}
                or state not in TRANSACTION_STATES
            ):
                raise ValueError("required transaction fields are invalid")
            old_metadata = raw.get("oldActiveMetadata")
            if old_metadata is not None and not isinstance(old_metadata, dict):
                raise ValueError("old active metadata is invalid")
            revision_id = raw.get("archivedRevisionId")
            if revision_id is not None and (
                not isinstance(revision_id, str)
                or not re.fullmatch(r"rev_[0-9a-f]{32}", revision_id)
            ):
                raise ValueError("archived revision id is invalid")
            backup_relative = raw.get("backupRelative")
            if backup_relative is not None:
                if not isinstance(backup_relative, str) or not backup_relative:
                    raise ValueError("backup path is invalid")
                backup = (self.backup_root / backup_relative).resolve()
                expected_parent = (
                    self.backup_root / self.package_install_path(package_id).name
                ).resolve()
                if (
                    not backup.is_relative_to(self.backup_root.resolve())
                    or backup.parent != expected_parent
                ):
                    raise ValueError("backup path is outside the package backup slot")
            return _NodePackageTransaction(path=path.resolve(), data=raw)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            raise NodePackageInstallError(
                "node_package_transaction_corrupt",
                f"节点包事务记录损坏：{path.name}。",
                status_code=500,
            ) from exc

    def _recover_transactions_locked(self) -> list[NodePackageRecoveryEvent]:
        if not self.transaction_root.exists():
            return []
        recovered: list[NodePackageRecoveryEvent] = []
        for path in sorted(self.transaction_root.glob("tx_*.json")):
            transaction = self._read_transaction(path)
            state = transaction.data["state"]
            operation = transaction.data["operation"]
            if state == "committed":
                self._complete_committed_transaction(transaction, best_effort=False)
                action: Literal["rolled_back", "completed"] = "completed"
            else:
                self._rollback_transaction(transaction)
                action = "rolled_back"
            recovered.append(
                NodePackageRecoveryEvent(
                    transaction_id=str(transaction.data["transactionId"]),
                    package_id=str(transaction.data["packageId"]),
                    operation=operation,
                    action=action,
                    recovered_at=self._now(),
                )
            )
        return recovered

    def _rollback_transaction(self, transaction: _NodePackageTransaction) -> None:
        package_id = str(transaction.data["packageId"])
        operation = transaction.data["operation"]
        state = transaction.data["state"]
        destination = self.package_install_path(package_id)
        backup = self._transaction_backup(transaction)
        revision_dir = self._transaction_revision_dir(transaction)

        if revision_dir is not None and revision_dir.exists():
            self._remove_tree(revision_dir, allowed_root=self.history_root)

        if backup is not None and backup.exists():
            if destination.exists():
                self._remove_tree(destination, allowed_root=self.install_root)
            os.replace(backup, destination)
        elif operation == "activate" and transaction.data.get("oldActiveMetadata") is None:
            if state != "prepared" and destination.exists():
                self._remove_tree(destination, allowed_root=self.install_root)
        elif not destination.exists():
            raise NodePackageInstallError(
                "node_package_recovery_failed",
                f"节点包事务 {transaction.data['transactionId']} 缺少可恢复的旧版本。",
                status_code=500,
            )

        self._restore_active_metadata(
            package_id,
            transaction.data.get("oldActiveMetadata"),
        )
        transaction.path.unlink(missing_ok=True)
        self._cleanup_empty_backup_dir(package_id)

    def _complete_committed_transaction(
        self,
        transaction: _NodePackageTransaction,
        *,
        best_effort: bool = True,
    ) -> None:
        package_id = str(transaction.data["packageId"])
        operation = transaction.data["operation"]
        destination = self.package_install_path(package_id)
        backup = self._transaction_backup(transaction)
        try:
            if operation == "uninstall":
                if destination.exists():
                    self._remove_tree(destination, allowed_root=self.install_root)
                if backup is not None and backup.exists():
                    self._remove_tree(backup, allowed_root=self.backup_root)
                self._remove_package_state(package_id)
            elif backup is not None and backup.exists():
                self._remove_tree(backup, allowed_root=self.backup_root)
            transaction.path.unlink(missing_ok=True)
            self._cleanup_empty_backup_dir(package_id)
        except OSError:
            if not best_effort:
                raise

    def _transaction_backup(self, transaction: _NodePackageTransaction) -> Path | None:
        relative = transaction.data.get("backupRelative")
        if not isinstance(relative, str):
            return None
        return (self.backup_root / relative).resolve()

    def _transaction_revision_dir(
        self,
        transaction: _NodePackageTransaction,
    ) -> Path | None:
        revision_id = transaction.data.get("archivedRevisionId")
        if not isinstance(revision_id, str):
            return None
        return self._package_history_dir(str(transaction.data["packageId"])) / revision_id

    def _cleanup_staging_root(self) -> None:
        if not self.staging_root.exists():
            return
        for path in self.staging_root.iterdir():
            if path.is_dir():
                self._remove_tree(path, allowed_root=self.staging_root)
            else:
                path.unlink(missing_ok=True)

    def _list_revisions_locked(self, package_id: str) -> list[NodePackageRevision]:
        history_dir = self._package_history_dir(package_id)
        if not history_dir.exists():
            return []
        revisions = [
            self._read_revision(revision_dir)
            for revision_dir in history_dir.iterdir()
            if revision_dir.is_dir()
        ]
        return sorted(revisions, key=lambda item: item.archived_at, reverse=True)

    def _require_installed_package(self, package_id: str) -> NodePackageInfo:
        node_package = self._find_package(package_id)
        if node_package is None:
            raise NodePackageInstallError(
                "node_package_not_found",
                "节点包不存在。",
                status_code=404,
            )
        if node_package.source != "installed":
            raise NodePackageInstallError(
                "node_package_not_install_managed",
                "工作区源码包和内置包没有可管理的安装历史。",
                status_code=409,
            )
        return node_package

    def _find_package(self, package_id: str) -> NodePackageInfo | None:
        return next(
            (candidate for candidate in self.registry.list_packages() if candidate.id == package_id),
            None,
        )

    def _package_policy(self, package_id: str) -> NodePackagePolicy:
        provider = self.registry.package_policy_provider
        if provider is None:
            return NodePackagePolicy(package_id=package_id)
        return provider().get(package_id, NodePackagePolicy(package_id=package_id))

    def _package_node_ids(self, node_package: NodePackageInfo) -> tuple[str, ...]:
        if node_package.node_ids:
            return node_package.node_ids
        isolated_registry = NodeRegistry(nodes_dir=node_package.root_path)
        scan = isolated_registry.scan()
        isolated_package = next(
            (candidate for candidate in scan.packages if candidate.id == node_package.id),
            None,
        )
        return isolated_package.node_ids if isolated_package is not None else ()

    def _require_unreferenced(
        self,
        node_type_ids: tuple[str, ...],
        *,
        message: str,
    ) -> None:
        if not node_type_ids or self.node_type_reference_provider is None:
            return
        references = self.node_type_reference_provider(node_type_ids)
        if not references:
            return
        raise NodePackageInstallError(
            "node_package_referenced",
            message,
            status_code=409,
            context={
                "references": [reference.model_dump() for reference in references],
            },
        )

    def _backup_path(self, package_id: str, version: str) -> Path:
        return self.backup_root / self.package_install_path(package_id).name / f"{version}-{uuid4().hex}"

    def _package_history_dir(self, package_id: str) -> Path:
        return self.history_root / self.package_install_path(package_id).name

    def _active_metadata_path(self, package_id: str) -> Path:
        return self.active_metadata_root / f"{self.package_install_path(package_id).name}.json"

    def _archive_previous_active(
        self,
        backup: Path,
        *,
        node_package: NodePackageInfo,
        active_metadata: dict[str, object] | None,
        revision_id: str,
    ) -> Path:
        self._remove_bytecode_cache(backup)
        revision_dir = self._package_history_dir(node_package.id) / revision_id
        package_path = revision_dir / "package"
        revision_dir.mkdir(parents=True, exist_ok=False)
        try:
            shutil.copytree(backup, package_path)
            metadata = {
                "revisionId": revision_id,
                "packageId": node_package.id,
                "version": node_package.version,
                "sourceFilename": (
                    active_metadata.get("sourceFilename") if active_metadata else None
                ),
                "installedAt": (
                    active_metadata.get("installedAt") if active_metadata else None
                ),
                "archivedAt": self._now(),
                "checksum": self._directory_checksum(package_path),
            }
            self._write_json_atomic(revision_dir / "metadata.json", metadata)
        except Exception:
            if revision_dir.exists():
                self._remove_tree(revision_dir, allowed_root=self.history_root)
            raise
        return revision_dir

    def _read_revision(self, revision_dir: Path) -> NodePackageRevision:
        try:
            raw = json.loads((revision_dir / "metadata.json").read_text(encoding="utf-8"))
            required = (
                "revisionId",
                "packageId",
                "version",
                "archivedAt",
                "checksum",
            )
            if not isinstance(raw, dict) or any(
                not isinstance(raw.get(field), str) or not raw[field]
                for field in required
            ):
                raise ValueError("metadata fields are invalid")
            if raw["revisionId"] != revision_dir.name:
                raise ValueError("revision id does not match directory")
            for optional in ("sourceFilename", "installedAt"):
                if raw.get(optional) is not None and not isinstance(raw[optional], str):
                    raise ValueError(f"{optional} is invalid")
            package_path = (revision_dir / "package").resolve()
            if not package_path.is_dir() or not package_path.is_relative_to(self.history_root):
                raise ValueError("revision package directory is missing")
            return NodePackageRevision(
                revision_id=raw["revisionId"],
                package_id=raw["packageId"],
                version=raw["version"],
                source_filename=raw.get("sourceFilename"),
                installed_at=raw.get("installedAt"),
                archived_at=raw["archivedAt"],
                checksum=raw["checksum"],
                package_path=package_path,
            )
        except (OSError, ValueError, json.JSONDecodeError, KeyError) as exc:
            raise NodePackageInstallError(
                "node_package_revision_corrupt",
                f"节点包历史记录损坏：{revision_dir.name}。",
                status_code=500,
            ) from exc

    def _read_active_metadata(self, package_id: str) -> dict[str, object] | None:
        path = self._active_metadata_path(package_id)
        if not path.is_file():
            return None
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise NodePackageInstallError(
                "node_package_active_metadata_corrupt",
                "节点包当前版本记录损坏，已停止变更。",
                status_code=500,
            ) from exc
        if not isinstance(raw, dict) or raw.get("packageId") != package_id:
            raise NodePackageInstallError(
                "node_package_active_metadata_corrupt",
                "节点包当前版本记录无效，已停止变更。",
                status_code=500,
            )
        return raw

    def _write_active_metadata(self, package_id: str, metadata: dict[str, object]) -> None:
        self._write_json_atomic(self._active_metadata_path(package_id), metadata)

    def _restore_active_metadata(
        self,
        package_id: str,
        metadata: dict[str, object] | None,
    ) -> None:
        path = self._active_metadata_path(package_id)
        if metadata is None:
            path.unlink(missing_ok=True)
            return
        self._write_json_atomic(path, metadata)

    def _remove_package_state(self, package_id: str) -> None:
        self._active_metadata_path(package_id).unlink(missing_ok=True)
        history_dir = self._package_history_dir(package_id)
        if history_dir.exists():
            self._remove_tree(history_dir, allowed_root=self.history_root)
        self._cleanup_empty_backup_dir(package_id)

    def _cleanup_empty_backup_dir(self, package_id: str) -> None:
        package_backup_dir = self.backup_root / self.package_install_path(package_id).name
        try:
            package_backup_dir.rmdir()
        except FileNotFoundError:
            pass
        except OSError:
            # A non-empty directory can belong to an in-flight transaction.
            pass

    def _prune_revisions(self, package_id: str) -> None:
        try:
            revisions = self._list_revisions_locked(package_id)
        except NodePackageInstallError:
            return
        for revision in revisions[MAX_PACKAGE_REVISIONS:]:
            revision_dir = revision.package_path.parent
            if revision_dir.exists():
                self._remove_tree(revision_dir, allowed_root=self.history_root)

    @staticmethod
    def _write_json_atomic(path: Path, value: dict[str, object]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
        try:
            temporary.write_text(
                json.dumps(value, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    @staticmethod
    def _directory_checksum(package_root: Path) -> str:
        digest = hashlib.sha256()
        for path in sorted(candidate for candidate in package_root.rglob("*") if candidate.is_file()):
            relative = path.relative_to(package_root).as_posix()
            if "__pycache__" in path.parts or path.suffix == ".pyc":
                continue
            digest.update(relative.encode("utf-8"))
            digest.update(b"\0")
            digest.update(path.read_bytes())
            digest.update(b"\0")
        return digest.hexdigest()

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _remove_bytecode_cache(self, package_root: Path) -> None:
        for cache_dir in sorted(package_root.rglob("__pycache__"), reverse=True):
            self._remove_tree(cache_dir, allowed_root=package_root)
        for bytecode_file in package_root.rglob("*.pyc"):
            bytecode_file.unlink()

    @staticmethod
    def _remove_tree(path: Path, *, allowed_root: Path) -> None:
        resolved = path.resolve()
        root = allowed_root.resolve()
        if resolved == root or not resolved.is_relative_to(root):
            raise RuntimeError(f"Refusing to remove path outside package state: {resolved}")
        shutil.rmtree(resolved)
