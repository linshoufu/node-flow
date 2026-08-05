"""Preflight local node packages before importing their Python entrypoints."""

from __future__ import annotations

import importlib.metadata
import platform
from dataclasses import dataclass
from typing import Any, Literal, Mapping

from packaging.requirements import Requirement
from packaging.specifiers import SpecifierSet
from packaging.version import InvalidVersion, Version

from nodeflow_sdk.version import NODEFLOW_ENGINE_VERSION


PackageCompatibilityStatus = Literal["compatible", "unverified", "incompatible"]


@dataclass(frozen=True)
class PackageCompatibilityIssue:
    code: str
    level: Literal["error", "warning"]
    message: str


@dataclass(frozen=True)
class PackageCompatibilityResult:
    status: PackageCompatibilityStatus
    nodeflow_version: str
    python_version: str
    issues: tuple[PackageCompatibilityIssue, ...]


def check_package_compatibility(
    manifest: Mapping[str, Any],
) -> PackageCompatibilityResult:
    """Check engine ranges and installed distributions without changing the environment."""

    issues: list[PackageCompatibilityIssue] = []
    engines = manifest.get("engines")
    if engines is None:
        issues.append(
            PackageCompatibilityIssue(
                code="package_engine_constraints_missing",
                level="warning",
                message="节点包未声明 Node Flow 与 Python 兼容范围，当前仅按旧版清单尝试加载。",
            )
        )
        engines = {}

    nodeflow_spec = engines.get("nodeflow")
    python_spec = engines.get("python")
    missing_engines = [
        label
        for label, value in (("Node Flow", nodeflow_spec), ("Python", python_spec))
        if value is None
    ]
    if manifest.get("engines") is not None and missing_engines:
        issues.append(
            PackageCompatibilityIssue(
                code="package_engine_constraints_incomplete",
                level="warning",
                message=f"节点包未声明 {'、'.join(missing_engines)} 兼容范围。",
            )
        )

    if nodeflow_spec is not None and Version(NODEFLOW_ENGINE_VERSION) not in SpecifierSet(
        nodeflow_spec
    ):
        issues.append(
            PackageCompatibilityIssue(
                code="package_nodeflow_engine_incompatible",
                level="error",
                message=(
                    f"节点包要求 Node Flow {nodeflow_spec}，"
                    f"当前版本为 {NODEFLOW_ENGINE_VERSION}。"
                ),
            )
        )

    python_version = platform.python_version()
    if python_spec is not None and Version(python_version) not in SpecifierSet(python_spec):
        issues.append(
            PackageCompatibilityIssue(
                code="package_python_engine_incompatible",
                level="error",
                message=f"节点包要求 Python {python_spec}，当前版本为 {python_version}。",
            )
        )

    for raw_requirement in manifest.get("pythonDependencies", []):
        requirement = Requirement(raw_requirement)
        if requirement.marker is not None and not requirement.marker.evaluate():
            continue
        try:
            installed_version_text = importlib.metadata.version(requirement.name)
        except importlib.metadata.PackageNotFoundError:
            issues.append(
                PackageCompatibilityIssue(
                    code="package_python_dependency_missing",
                    level="error",
                    message=f"节点包依赖尚未安装：{requirement}。",
                )
            )
            continue
        try:
            installed_version = Version(installed_version_text)
        except InvalidVersion:
            issues.append(
                PackageCompatibilityIssue(
                    code="package_python_dependency_incompatible",
                    level="error",
                    message=(
                        f"节点包依赖 {requirement.name} 的已安装版本"
                        f"“{installed_version_text}”无法比较。"
                    ),
                )
            )
            continue
        if requirement.specifier and installed_version not in requirement.specifier:
            issues.append(
                PackageCompatibilityIssue(
                    code="package_python_dependency_incompatible",
                    level="error",
                    message=(
                        f"节点包要求 {requirement}，"
                        f"当前已安装 {requirement.name} {installed_version_text}。"
                    ),
                )
            )

    if any(issue.level == "error" for issue in issues):
        status: PackageCompatibilityStatus = "incompatible"
    elif issues:
        status = "unverified"
    else:
        status = "compatible"
    return PackageCompatibilityResult(
        status=status,
        nodeflow_version=NODEFLOW_ENGINE_VERSION,
        python_version=python_version,
        issues=tuple(issues),
    )
