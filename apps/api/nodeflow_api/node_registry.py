from __future__ import annotations

import hashlib
import importlib.util
import inspect
import json
import re
import sys
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field, replace
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Literal, Mapping

from packaging.requirements import InvalidRequirement, Requirement
from packaging.specifiers import InvalidSpecifier, SpecifierSet
from packaging.version import InvalidVersion, Version

from nodeflow_sdk import BaseNode, DynamicInputList, DynamicOutputList, Input, Output

from .credentials import CredentialType, credential_type_by_id, credential_type_from_manifest
from .node_package_compatibility import (
    PackageCompatibilityStatus,
    check_package_compatibility,
)
from .node_package_lifecycle import NodePackagePolicy
from .node_registry_manifest import (
    apply_manifest_defaults,
    apply_manifest_port_presentation,
    merge_form_with_manifest,
    read_manifest,
)


@dataclass(frozen=True)
class NodePackageInfo:
    id: str
    name: str
    version: str
    description: str | None
    documentation_url: str | None
    icon: str | None
    author: str | None
    root_path: Path
    status: Literal["loaded", "partial", "failed", "disabled"]
    node_ids: tuple[str, ...]
    credential_type_ids: tuple[str, ...] = ()
    engines: Mapping[str, str] = field(default_factory=lambda: MappingProxyType({}))
    python_dependencies: tuple[str, ...] = ()
    compatibility: PackageCompatibilityStatus = "unverified"
    nodeflow_version: str | None = None
    python_version: str | None = None
    managed: bool = True
    enabled: bool = True
    locked_version: str | None = None
    version_status: Literal["unlocked", "locked", "mismatch"] = "unlocked"
    source: Literal["builtin", "installed", "workspace"] = "workspace"

    def provenance_api_dict(self) -> dict[str, str]:
        return {"id": self.id, "name": self.name, "version": self.version}

    def to_api_dict(self) -> dict[str, Any]:
        return {
            **self.provenance_api_dict(),
            "description": self.description,
            "documentationUrl": self.documentation_url,
            "icon": self.icon,
            "author": self.author,
            "status": self.status,
            "nodeIds": list(self.node_ids),
            "credentialTypeIds": list(self.credential_type_ids),
            "engines": dict(self.engines),
            "pythonDependencies": list(self.python_dependencies),
            "compatibility": {
                "status": self.compatibility,
                "nodeflowVersion": self.nodeflow_version,
                "pythonVersion": self.python_version,
            },
            "lifecycle": {
                "managed": self.managed,
                "enabled": self.enabled,
                "lockedVersion": self.locked_version,
                "versionStatus": self.version_status,
                "installManaged": self.source == "installed",
            },
        }


@dataclass(frozen=True)
class NodePackageDiagnostic:
    code: str
    level: Literal["error", "warning"]
    message: str
    package_id: str | None = None
    path: str | None = None
    entrypoint: str | None = None

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "level": self.level,
            "message": self.message,
            "packageId": self.package_id,
            "path": self.path,
            "entrypoint": self.entrypoint,
        }


@dataclass(frozen=True)
class NodeRegistryScanResult:
    packages: tuple[NodePackageInfo, ...] = ()
    diagnostics: tuple[NodePackageDiagnostic, ...] = ()
    legacy_node_count: int = 0

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "packages": [package.to_api_dict() for package in self.packages],
            "diagnostics": [diagnostic.to_api_dict() for diagnostic in self.diagnostics],
            "legacyNodeCount": self.legacy_node_count,
        }


@dataclass(frozen=True)
class RegisteredNodeType:
    id: str
    name: str
    category: str
    description: str
    display_name: str
    group: str
    icon: str | None
    tags: tuple[str, ...]
    keywords: tuple[str, ...]
    documentation_url: str | None
    version: int
    inputs: dict[str, dict[str, Any]]
    outputs: dict[str, dict[str, Any]]
    config_schema: dict[str, Any]
    form: dict[str, Any] | None
    dynamic_inputs: dict[str, Any] | None
    dynamic_outputs: dict[str, Any] | None
    node_class: type[BaseNode[Any]]
    package: NodePackageInfo | None = None
    # 节点定义所在的源文件，相对 nodes_dir 的 posix 路径；供节点资产管理页展示与打开源文件。
    source_path: str | None = None

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "displayName": self.display_name,
            "category": self.category,
            "group": self.group,
            "icon": self.icon,
            "tags": list(self.tags),
            "keywords": list(self.keywords),
            "documentationUrl": self.documentation_url,
            "version": self.version,
            "description": self.description,
            "inputs": self.inputs,
            "outputs": self.outputs,
            "configSchema": self.config_schema,
            "form": self.form,
            "dynamicInputs": self.dynamic_inputs,
            "dynamicOutputs": self.dynamic_outputs,
            "package": self.package.provenance_api_dict() if self.package else None,
            "sourcePath": self.source_path,
        }

@dataclass(frozen=True)
class NodeRegistrySnapshot:
    """Immutable node lookup captured for one workflow execution."""

    _nodes: Mapping[str, RegisteredNodeType]

    def get(self, node_id: str) -> RegisteredNodeType:
        try:
            return self._nodes[node_id]
        except KeyError as exc:
            raise KeyError(f"Unknown node type: {node_id}") from exc

    def has(self, node_id: str) -> bool:
        return node_id in self._nodes


class NodeRegistry:
    def __init__(
        self,
        *,
        nodes_dir: Path,
        package_policy_provider: Callable[[], Mapping[str, NodePackagePolicy]] | None = None,
    ) -> None:
        self.nodes_dir = nodes_dir
        self.package_policy_provider = package_policy_provider
        self._nodes: dict[str, RegisteredNodeType] = {}
        self._packages: list[NodePackageInfo] = []
        self._diagnostics: list[NodePackageDiagnostic] = []
        self._credential_types: dict[str, CredentialType] = {}
        self._legacy_node_count = 0
        self._source_fingerprint: tuple[tuple[str, int, int], ...] = ()
        self._policy_fingerprint: tuple[tuple[str, bool, str | None], ...] = ()
        self._package_policies: dict[str, NodePackagePolicy] = {}
        self._mutation_lock = threading.RLock()
        self.scan_result = NodeRegistryScanResult()

    def scan(self) -> NodeRegistryScanResult:
        with self._mutation_lock:
            staging = NodeRegistry(
                nodes_dir=self.nodes_dir,
                package_policy_provider=self.package_policy_provider,
            )
            staging._scan_in_place()
            (
                self._nodes,
                self._packages,
                self._diagnostics,
                self._credential_types,
                self._legacy_node_count,
                self._source_fingerprint,
                self._policy_fingerprint,
                self._package_policies,
                self.scan_result,
            ) = (
                staging._nodes,
                staging._packages,
                staging._diagnostics,
                staging._credential_types,
                staging._legacy_node_count,
                staging._source_fingerprint,
                staging._policy_fingerprint,
                staging._package_policies,
                staging.scan_result,
            )
            return self.scan_result

    def scan_if_changed(self) -> bool:
        with self._mutation_lock:
            if (
                self._source_fingerprint == self._current_source_fingerprint()
                and self._policy_fingerprint == self._current_policy_fingerprint()
            ):
                return False
            self.scan()
            return True

    @contextmanager
    def mutation_lock(self):
        """Serialize source mutations with scans in this process."""

        with self._mutation_lock:
            yield

    def _scan_in_place(self) -> None:
        self._nodes = {}
        self._packages = []
        self._diagnostics = []
        self._credential_types = {}
        self._legacy_node_count = 0
        self._source_fingerprint = self._current_source_fingerprint()
        self._package_policies = self._current_package_policies()
        self._policy_fingerprint = _package_policy_fingerprint(self._package_policies)
        if not self.nodes_dir.exists():
            self.scan_result = NodeRegistryScanResult()
            return

        manifest_paths = sorted(self.nodes_dir.rglob("nodeflow-package.json"))
        package_roots = {manifest_path.parent.resolve() for manifest_path in manifest_paths}
        package_ids: set[str] = set()
        for manifest_path in manifest_paths:
            self._load_manifest_package(manifest_path, package_ids)
        self._load_legacy_files(package_roots)
        self.scan_result = NodeRegistryScanResult(
            packages=tuple(self._packages),
            diagnostics=tuple(self._diagnostics),
            legacy_node_count=self._legacy_node_count,
        )

    def _current_source_fingerprint(self) -> tuple[tuple[str, int, int], ...]:
        if not self.nodes_dir.exists():
            return ()
        source_paths = [
            *self.nodes_dir.rglob("*.py"),
            *self.nodes_dir.rglob("nodeflow-package.json"),
            *self.nodes_dir.rglob("*.nodeform.json"),
        ]
        entries: list[tuple[str, int, int]] = []
        for path in source_paths:
            if not path.is_file():
                continue
            stat = path.stat()
            entries.append(
                (
                    path.relative_to(self.nodes_dir).as_posix(),
                    stat.st_mtime_ns,
                    stat.st_size,
                )
            )
        return tuple(sorted(entries))

    def _current_package_policies(self) -> dict[str, NodePackagePolicy]:
        if self.package_policy_provider is None:
            return {}
        return dict(self.package_policy_provider())

    def _current_policy_fingerprint(self) -> tuple[tuple[str, bool, str | None], ...]:
        return _package_policy_fingerprint(self._current_package_policies())

    def list_node_types(self) -> list[RegisteredNodeType]:
        return sorted(
            self._nodes.values(), key=lambda node_type: (node_type.category, node_type.name)
        )

    def get_node_type(self, node_type_id: str) -> RegisteredNodeType | None:
        """获取单个节点类型，供 manifest API 与编辑页查询。"""
        return self._nodes.get(node_type_id)

    def source_path_for(self, node_type_id: str) -> Path | None:
        """获取节点类型的源文件绝对路径，供 manifest 读写定位。"""
        node_type = self._nodes.get(node_type_id)
        if node_type is None or not node_type.source_path:
            return None
        return self.nodes_dir.resolve() / node_type.source_path

    def snapshot(self) -> NodeRegistrySnapshot:
        return NodeRegistrySnapshot(MappingProxyType(dict(self._nodes)))

    def list_packages(self) -> list[NodePackageInfo]:
        return list(self._packages)

    def list_credential_types(self) -> list[CredentialType]:
        return list(self._credential_types.values())

    def get_credential_type(self, type_id: str) -> CredentialType | None:
        return self._credential_types.get(type_id)

    def get(self, node_id: str) -> RegisteredNodeType:
        try:
            return self._nodes[node_id]
        except KeyError as exc:
            raise KeyError(f"Unknown node type: {node_id}") from exc

    def has(self, node_id: str) -> bool:
        return node_id in self._nodes

    def _load_manifest_package(self, manifest_path: Path, package_ids: set[str]) -> None:
        root_path = manifest_path.parent.resolve()
        try:
            manifest = self._parse_manifest(manifest_path)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            self._record_diagnostic(
                "package_manifest_invalid",
                f"节点包清单无效：{exc}",
                path=self._relative_path(manifest_path),
            )
            return

        package = NodePackageInfo(
            id=manifest["id"],
            name=manifest["name"],
            version=manifest["version"],
            description=manifest.get("description"),
            documentation_url=manifest.get("documentationUrl"),
            icon=manifest.get("icon"),
            author=manifest.get("author"),
            root_path=root_path,
            status="loaded",
            node_ids=(),
            engines=MappingProxyType(dict(manifest.get("engines", {}))),
            python_dependencies=tuple(manifest.get("pythonDependencies", [])),
        )
        compatibility = check_package_compatibility(manifest)
        managed = package.id != "nodeflow.builtin"
        source: Literal["builtin", "installed", "workspace"]
        if not managed:
            source = "builtin"
        elif root_path.parent == (self.nodes_dir.resolve() / "_installed"):
            source = "installed"
        else:
            source = "workspace"
        policy = (
            self._package_policies.get(package.id, NodePackagePolicy(package_id=package.id))
            if managed
            else NodePackagePolicy(package_id=package.id)
        )
        version_status: Literal["unlocked", "locked", "mismatch"] = "unlocked"
        if policy.locked_version is not None:
            version_status = (
                "locked"
                if Version(policy.locked_version) == Version(package.version)
                else "mismatch"
            )
        package = replace(
            package,
            compatibility=compatibility.status,
            nodeflow_version=compatibility.nodeflow_version,
            python_version=compatibility.python_version,
            managed=managed,
            enabled=policy.enabled,
            locked_version=policy.locked_version,
            version_status=version_status,
            source=source,
        )
        if package.id in package_ids:
            self._record_diagnostic(
                "package_id_duplicate",
                f"节点包 ID 重复：{package.id}",
                package_id=package.id,
                path=self._relative_path(manifest_path),
            )
            self._packages.append(replace(package, status="failed"))
            return
        package_ids.add(package.id)

        if not package.enabled:
            self._packages.append(replace(package, status="disabled"))
            return
        if package.version_status == "mismatch":
            self._record_diagnostic(
                "package_version_lock_mismatch",
                (
                    f"节点包当前版本 {package.version} 与锁定版本 "
                    f"{package.locked_version} 不一致，请确认升级或恢复原版本。"
                ),
                package_id=package.id,
                path=self._relative_path(manifest_path),
            )
            self._packages.append(replace(package, status="failed"))
            return

        for issue in compatibility.issues:
            self._record_diagnostic(
                issue.code,
                issue.message,
                level=issue.level,
                package_id=package.id,
                path=self._relative_path(manifest_path),
            )
        if compatibility.status == "incompatible":
            self._packages.append(replace(package, status="failed"))
            return

        node_ids: list[str] = []
        error_count = 0
        for entrypoint in manifest["nodeEntrypoints"]:
            entry_path = self._entrypoint_path(package, entrypoint)
            if entry_path is None:
                error_count += 1
                continue
            if not entry_path.is_file():
                error_count += 1
                self._record_diagnostic(
                    "package_entrypoint_missing",
                    f"节点包入口文件不存在：{entrypoint}",
                    package_id=package.id,
                    path=self._relative_path(manifest_path),
                    entrypoint=entrypoint,
                )
                continue
            try:
                loaded_node_ids = self._load_file(entry_path, package=package)
                if not loaded_node_ids:
                    error_count += 1
                    self._record_diagnostic(
                        "package_entrypoint_no_nodes",
                        f"节点包入口没有注册任何节点：{entrypoint}",
                        package_id=package.id,
                        path=self._relative_path(entry_path),
                        entrypoint=entrypoint,
                    )
                    continue
                node_ids.extend(loaded_node_ids)
            except Exception as exc:
                error_count += 1
                self._record_diagnostic(
                    "package_entrypoint_load_failed",
                    f"节点包入口加载失败：{entrypoint}（{exc}）",
                    package_id=package.id,
                    path=self._relative_path(manifest_path),
                    entrypoint=entrypoint,
                )

        credential_type_ids: list[str] = []
        for raw_credential_type in manifest.get("credentialTypes", []):
            try:
                credential_type = credential_type_from_manifest(raw_credential_type)
                if credential_type_by_id(credential_type.id) is not None or credential_type.id in self._credential_types:
                    raise ValueError(f"凭据类型 ID 已存在：{credential_type.id}")
                unknown_node_ids = set(credential_type.node_type_ids) - set(node_ids)
                if unknown_node_ids:
                    joined_ids = ", ".join(sorted(unknown_node_ids))
                    raise ValueError(f"只能关联当前节点包已加载的节点：{joined_ids}")
            except ValueError as exc:
                error_count += 1
                self._record_diagnostic(
                    "package_credential_type_invalid",
                    f"节点包凭据类型无效：{exc}",
                    package_id=package.id,
                    path=self._relative_path(manifest_path),
                )
                continue
            self._credential_types[credential_type.id] = credential_type
            credential_type_ids.append(credential_type.id)

        status: Literal["loaded", "partial", "failed", "disabled"]
        if node_ids and error_count:
            status = "partial"
        elif node_ids:
            status = "loaded"
        else:
            status = "failed"
        completed_package = replace(
            package,
            status=status,
            node_ids=tuple(node_ids),
            credential_type_ids=tuple(credential_type_ids),
        )
        self._packages.append(completed_package)
        for node_id in node_ids:
            self._nodes[node_id] = replace(self._nodes[node_id], package=completed_package)

    def _parse_manifest(self, manifest_path: Path) -> dict[str, Any]:
        raw_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(raw_manifest, dict):
            raise ValueError("清单必须是 JSON 对象")
        for field_name in ("id", "name", "version"):
            value = raw_manifest.get(field_name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"字段 {field_name} 必须是非空字符串")
        try:
            Version(raw_manifest["version"])
        except InvalidVersion as exc:
            raise ValueError(f"字段 version 不是有效版本号：{raw_manifest['version']}") from exc
        entrypoints = raw_manifest.get("nodeEntrypoints")
        if not isinstance(entrypoints, list) or not entrypoints or not all(
            isinstance(entrypoint, str) and entrypoint.strip() for entrypoint in entrypoints
        ):
            raise ValueError("字段 nodeEntrypoints 必须是非空字符串数组")
        for optional_name in ("description", "documentationUrl", "icon", "author"):
            optional_value = raw_manifest.get(optional_name)
            if optional_value is not None and not isinstance(optional_value, str):
                raise ValueError(f"字段 {optional_name} 必须是字符串")
        credential_types = raw_manifest.get("credentialTypes", [])
        if not isinstance(credential_types, list):
            raise ValueError("字段 credentialTypes 必须是数组")
        engines = raw_manifest.get("engines")
        if engines is not None:
            if not isinstance(engines, dict):
                raise ValueError("字段 engines 必须是对象")
            unknown_engines = set(engines) - {"nodeflow", "python"}
            if unknown_engines:
                raise ValueError(f"字段 engines 包含未知引擎：{', '.join(sorted(unknown_engines))}")
            for engine_name, specifier in engines.items():
                if not isinstance(specifier, str) or not specifier.strip():
                    raise ValueError(f"字段 engines.{engine_name} 必须是非空字符串")
                try:
                    SpecifierSet(specifier)
                except InvalidSpecifier as exc:
                    raise ValueError(
                        f"字段 engines.{engine_name} 不是有效版本范围：{specifier}"
                    ) from exc
        python_dependencies = raw_manifest.get("pythonDependencies", [])
        if not isinstance(python_dependencies, list):
            raise ValueError("字段 pythonDependencies 必须是字符串数组")
        dependency_names: set[str] = set()
        for raw_requirement in python_dependencies:
            if not isinstance(raw_requirement, str) or not raw_requirement.strip():
                raise ValueError("字段 pythonDependencies 必须是字符串数组")
            try:
                requirement = Requirement(raw_requirement)
            except InvalidRequirement as exc:
                raise ValueError(f"Python 依赖声明无效：{raw_requirement}") from exc
            normalized_name = re.sub(r"[-_.]+", "-", requirement.name).lower()
            if normalized_name in dependency_names:
                raise ValueError(f"Python 依赖重复声明：{requirement.name}")
            dependency_names.add(normalized_name)
        return raw_manifest

    def _entrypoint_path(self, package: NodePackageInfo, entrypoint: str) -> Path | None:
        candidate = (package.root_path / entrypoint).resolve()
        if candidate.suffix != ".py" or not candidate.is_relative_to(package.root_path):
            self._record_diagnostic(
                "package_entrypoint_invalid",
                f"节点包入口必须是包目录内的 Python 文件：{entrypoint}",
                package_id=package.id,
                entrypoint=entrypoint,
            )
            return None
        return candidate

    def _load_legacy_files(self, package_roots: set[Path]) -> None:
        for file_path in sorted(self.nodes_dir.rglob("*.py")):
            if file_path.name.startswith("_"):
                continue
            resolved_path = file_path.resolve()
            if any(resolved_path.is_relative_to(package_root) for package_root in package_roots):
                continue
            try:
                self._legacy_node_count += len(self._load_file(resolved_path))
            except Exception as exc:
                self._record_diagnostic(
                    "legacy_node_load_failed",
                    f"本地节点脚本加载失败：{exc}",
                    path=self._relative_path(resolved_path),
                )

    def _load_file(
        self, file_path: Path, *, package: NodePackageInfo | None = None
    ) -> list[str]:
        module_name = self._module_name_for(file_path)
        spec = importlib.util.spec_from_file_location(module_name, file_path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Cannot import node file: {file_path}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        registered_node_ids: list[str] = []
        for value in module.__dict__.values():
            if (
                inspect.isclass(value)
                and issubclass(value, BaseNode)
                and hasattr(value, "__node_meta__")
                and value.__module__ == module.__name__
                and self._register(value, file_path=file_path, package=package)
            ):
                registered_node_ids.append(value.__node_meta__.id)
        return registered_node_ids

    def _module_name_for(self, file_path: Path) -> str:
        resolved_path = file_path.resolve()
        try:
            path_parts = resolved_path.relative_to(self.nodes_dir.resolve()).with_suffix("").parts
        except ValueError:
            path_parts = resolved_path.with_suffix("").parts
        safe_parts = [re.sub(r"\W+", "_", part).strip("_") for part in path_parts]
        safe_stem = "_".join(part for part in safe_parts if part)
        path_hash = hashlib.sha1(str(resolved_path).encode("utf-8")).hexdigest()[:10]
        return f"nodeflow_user_node_{safe_stem}_{path_hash}"

    def _register(
        self,
        node_class: type[BaseNode[Any]],
        *,
        file_path: Path,
        package: NodePackageInfo | None,
    ) -> bool:
        meta = node_class.__node_meta__
        if meta.id in self._nodes:
            self._record_diagnostic(
                "node_id_duplicate",
                f"节点类型 ID 重复：{meta.id}",
                package_id=package.id if package else None,
                path=self._relative_path(file_path),
            )
            return False
        try:
            _validate_node_port_contracts(node_class)
            _validate_dynamic_port_contracts(node_class)
        except ValueError as exc:
            self._record_diagnostic(
                "node_port_contract_invalid",
                f"节点端口契约无效：{exc}",
                package_id=package.id if package else None,
                path=self._relative_path(file_path),
            )
            return False
        config_schema = node_class.config_schema()
        # 读取 manifest 并应用默认值覆盖
        manifest = read_manifest(file_path)
        config_schema = apply_manifest_defaults(config_schema, manifest)
        form = self._registered_form(
            node_class,
            config_schema=config_schema,
            file_path=file_path,
            package=package,
            manifest=manifest,
        )
        self._nodes[meta.id] = RegisteredNodeType(
            id=meta.id,
            name=meta.name,
            category=meta.category,
            description=meta.description,
            display_name=meta.display_name or meta.name,
            group=meta.group,
            icon=meta.icon,
            tags=meta.tags,
            keywords=meta.keywords,
            documentation_url=meta.documentation_url,
            version=meta.version,
            inputs=apply_manifest_port_presentation(
                {name: value.to_dict() for name, value in node_class.inputs.items()},
                manifest,
                "inputs",
            ),
            outputs=apply_manifest_port_presentation(
                {name: value.to_dict() for name, value in node_class.outputs.items()},
                manifest,
                "outputs",
            ),
            config_schema=config_schema,
            form=form,
            dynamic_inputs=(
                meta.dynamic_inputs.to_dict() if meta.dynamic_inputs is not None else None
            ),
            dynamic_outputs=(
                meta.dynamic_outputs.to_dict() if meta.dynamic_outputs is not None else None
            ),
            node_class=node_class,
            package=package,
            source_path=self._relative_path(file_path),
        )
        return True

    def _registered_form(
        self,
        node_class: type[BaseNode[Any]],
        *,
        config_schema: dict[str, Any],
        file_path: Path,
        package: NodePackageInfo | None,
        manifest: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        form = node_class.__node_meta__.form
        py_form_dict = form.to_dict() if form is not None else None

        # 合并 manifest 覆盖层
        merged_form = merge_form_with_manifest(py_form_dict, manifest, config_schema)
        if merged_form is None:
            return None

        try:
            _validate_node_form(merged_form, config_schema)
        except ValueError as exc:
            self._record_diagnostic(
                "node_form_invalid",
                f"节点表单描述无效：{exc}",
                package_id=package.id if package else None,
                path=self._relative_path(file_path),
            )
            return None
        return merged_form

    def _record_diagnostic(
        self,
        code: str,
        message: str,
        *,
        level: Literal["error", "warning"] = "error",
        package_id: str | None = None,
        path: str | None = None,
        entrypoint: str | None = None,
    ) -> None:
        self._diagnostics.append(
            NodePackageDiagnostic(
                code=code,
                level=level,
                message=message,
                package_id=package_id,
                path=path,
                entrypoint=entrypoint,
            )
        )

    def _relative_path(self, path: Path) -> str:
        try:
            return path.resolve().relative_to(self.nodes_dir.resolve()).as_posix()
        except ValueError:
            return path.name


PORT_HANDLE_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
PORT_FILTER_KEYS = {"nodes", "excludedNodes"}


def _package_policy_fingerprint(
    policies: Mapping[str, NodePackagePolicy],
) -> tuple[tuple[str, bool, str | None], ...]:
    return tuple(
        sorted(
            (
                package_id,
                policy.enabled,
                policy.locked_version,
            )
            for package_id, policy in policies.items()
        )
    )


def _validate_node_port_contracts(node_class: type[BaseNode[Any]]) -> None:
    validate_port_mapping(node_class.inputs, Input, "输入")
    validate_port_mapping(node_class.outputs, Output, "输出")


def _validate_dynamic_port_contracts(node_class: type[BaseNode[Any]]) -> None:
    meta = node_class.__node_meta__
    _validate_dynamic_port_contract(
        meta.dynamic_inputs,
        DynamicInputList,
        Input,
        node_class.inputs,
        "输入",
    )
    _validate_dynamic_port_contract(
        meta.dynamic_outputs,
        DynamicOutputList,
        Output,
        node_class.outputs,
        "输出",
    )


def _validate_dynamic_port_contract(
    dynamic: Any,
    expected_dynamic_type: type[DynamicInputList] | type[DynamicOutputList],
    expected_port_type: type[Input] | type[Output],
    static_ports: dict[str, Input] | dict[str, Output],
    direction: str,
) -> None:
    if dynamic is None:
        return
    if not isinstance(dynamic, expected_dynamic_type):
        raise ValueError(f"动态{direction}端口声明必须使用 {expected_dynamic_type.__name__}")
    for field_name in ("config_key", "id_key", "label_key"):
        value = getattr(dynamic, field_name)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"动态{direction}端口的 {field_name} 必须是非空字符串")
    if not isinstance(dynamic.input if isinstance(dynamic, DynamicInputList) else dynamic.output, expected_port_type):
        raise ValueError(f"动态{direction}端口必须使用 {expected_port_type.__name__} 声明")

    port = dynamic.input if isinstance(dynamic, DynamicInputList) else dynamic.output
    _validate_port_metadata(port, "<dynamic>", direction)
    default_items = dynamic.default_items
    if not isinstance(default_items, (list, tuple)):
        raise ValueError(f"动态{direction}端口的 default_items 必须是数组")
    seen_ids: set[str] = set()
    for index, item in enumerate(default_items):
        if not isinstance(item, dict):
            raise ValueError(f"动态{direction}端口的 default_items.{index} 必须是对象")
        port_id = item.get(dynamic.id_key)
        if not isinstance(port_id, str) or not PORT_HANDLE_PATTERN.fullmatch(port_id):
            raise ValueError(
                f"动态{direction}端口的 default_items.{index}.{dynamic.id_key} 必须匹配 {PORT_HANDLE_PATTERN.pattern}"
            )
        if port_id in static_ports or port_id in seen_ids:
            raise ValueError(f"动态{direction}端口的默认 ID {port_id!r} 与已有端口重复")
        seen_ids.add(port_id)


def validate_port_mapping(
    ports: Any,
    expected_type: type[Input] | type[Output],
    direction: str,
) -> None:
    if not isinstance(ports, dict):
        raise ValueError(f"{direction}端口必须是字典")

    for handle, port in ports.items():
        if not isinstance(handle, str) or not PORT_HANDLE_PATTERN.fullmatch(handle):
            raise ValueError(
                f"{direction}端口句柄 {handle!r} 必须匹配 {PORT_HANDLE_PATTERN.pattern}"
            )
        if not isinstance(port, expected_type):
            raise ValueError(
                f"{direction}端口 {handle!r} 必须使用 {expected_type.__name__} 声明"
            )
        _validate_port_metadata(port, handle, direction)


def _validate_port_metadata(port: Input | Output, handle: str, direction: str) -> None:
    if not isinstance(port.description, str):
        raise ValueError(f"{direction}端口 {handle!r} 的 description 必须是字符串")
    if port.display_name is not None and not isinstance(port.display_name, str):
        raise ValueError(f"{direction}端口 {handle!r} 的 display_name 必须是字符串")
    if port.category is not None and not isinstance(port.category, str):
        raise ValueError(f"{direction}端口 {handle!r} 的 category 必须是字符串")
    if port.schema is not None and not isinstance(port.schema, dict):
        raise ValueError(f"{direction}端口 {handle!r} 的 schema 必须是 JSON Schema 对象")
    if not isinstance(port.connection_kind, str) or not port.connection_kind.strip():
        raise ValueError(f"{direction}端口 {handle!r} 的 connection_kind 必须是非空字符串")
    if port.max_connections is not None and (
        isinstance(port.max_connections, bool)
        or not isinstance(port.max_connections, int)
        or port.max_connections < 0
    ):
        raise ValueError(f"{direction}端口 {handle!r} 的 max_connections 必须是非负整数或 None")

    _validate_port_filter(port.filter, handle, direction)
    if isinstance(port, Input):
        if not isinstance(port.required, bool):
            raise ValueError(f"输入端口 {handle!r} 的 required 必须是布尔值")
        if port.data_mode not in {"value", "items"}:
            raise ValueError(f"输入端口 {handle!r} 的 data_mode 必须是 'value' 或 'items'")


def _validate_port_filter(port_filter: Any, handle: str, direction: str) -> None:
    if port_filter is None:
        return
    if not isinstance(port_filter, dict):
        raise ValueError(f"{direction}端口 {handle!r} 的 filter 必须是对象")

    unknown_keys = sorted(str(key) for key in set(port_filter) - PORT_FILTER_KEYS)
    if unknown_keys:
        raise ValueError(
            f"{direction}端口 {handle!r} 的 filter 包含不支持的字段：{', '.join(unknown_keys)}"
        )
    for key in PORT_FILTER_KEYS:
        values = port_filter.get(key)
        if values is None:
            continue
        if not isinstance(values, list) or any(
            not isinstance(value, str) or not value.strip() for value in values
        ):
            raise ValueError(
                f"{direction}端口 {handle!r} 的 filter.{key} 必须是非空节点类型 ID 字符串数组"
            )


def _validate_node_form(form: dict[str, Any], config_schema: dict[str, Any]) -> None:
    properties = config_schema.get("properties")
    if not isinstance(properties, dict):
        raise ValueError("配置模型没有可用字段")
    groups = form.get("groups")
    if not isinstance(groups, list) or not groups:
        raise ValueError("至少需要一个表单分组")

    supported_controls = {
        "text",
        "textarea",
        "password",
        "number",
        "switch",
        "select",
        "json",
        "dynamic_output_list",
        "dynamic_input_list",
        "http_profile",
        "url",
        "credential",
    }
    group_ids: set[str] = set()
    field_keys: set[str] = set()
    for group in groups:
        if not isinstance(group, dict):
            raise ValueError("表单分组必须是对象")
        group_id = group.get("id")
        if not isinstance(group_id, str) or not group_id.strip() or group_id in group_ids:
            raise ValueError("分组 ID 必须唯一且非空")
        group_ids.add(group_id)
        _validate_condition(group.get("visibleWhen"), properties)
        fields = group.get("fields")
        if not isinstance(fields, list) or not fields:
            raise ValueError(f"分组 {group_id} 必须包含字段")
        for form_field in fields:
            if not isinstance(form_field, dict):
                raise ValueError(f"分组 {group_id} 包含无效字段")
            key = form_field.get("key")
            if not isinstance(key, str) or key not in properties:
                raise ValueError(f"字段 {key!r} 未在配置模型中声明")
            if key in field_keys:
                raise ValueError(f"字段 {key} 不能重复出现")
            field_keys.add(key)
            control = form_field.get("control")
            if control not in supported_controls:
                raise ValueError(f"字段 {key} 使用了不支持的控件 {control!r}")
            credential_type_ids = form_field.get("credentialTypeIds", [])
            if credential_type_ids and (
                control != "credential"
                or not isinstance(credential_type_ids, list)
                or not all(isinstance(type_id, str) and type_id for type_id in credential_type_ids)
                or len(set(credential_type_ids)) != len(credential_type_ids)
            ):
                raise ValueError(f"字段 {key} 的凭据类型声明无效")
            expression = form_field.get("expression")
            if expression is not None and expression not in {"allowed", "disabled", "required"}:
                raise ValueError(f"字段 {key} 使用了不支持的表达式模式 {expression!r}")
            options = form_field.get("options", [])
            if control == "select" and (not isinstance(options, list) or not options):
                raise ValueError(f"选择字段 {key} 必须声明选项")
            if options and not all(
                isinstance(option, dict)
                and isinstance(option.get("value"), str)
                and isinstance(option.get("label"), str)
                for option in options
            ):
                raise ValueError(f"字段 {key} 的选项无效")
            _validate_condition(form_field.get("visibleWhen"), properties)


def _validate_condition(condition: Any, properties: dict[str, Any]) -> None:
    if condition is None:
        return
    if not isinstance(condition, dict):
        raise ValueError("显示条件必须是对象")
    field = condition.get("field")
    if not isinstance(field, str) or field not in properties:
        raise ValueError("显示条件引用了未声明字段")
    modes = ["equals" in condition, "oneOf" in condition, condition.get("notEmpty") is True]
    if sum(modes) != 1:
        raise ValueError("显示条件必须且只能指定一种匹配方式")
    if "oneOf" in condition and (
        not isinstance(condition["oneOf"], list) or not condition["oneOf"]
    ):
        raise ValueError("显示条件 oneOf 必须是非空数组")
