"""Validate local Node Flow node packages with the production registry."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Sequence

from pydantic import ValidationError

from .node_ports import resolve_input_port_contract, resolve_output_port_contract
from .node_registry import (
    NodePackageDiagnostic,
    NodePackageInfo,
    NodeRegistry,
    RegisteredNodeType,
)
from .schemas import Position, WorkflowNode


@dataclass(frozen=True)
class NodeDoctorSummary:
    package_count: int
    loaded_package_count: int
    partial_package_count: int
    failed_package_count: int
    node_count: int
    credential_type_count: int
    legacy_node_count: int
    error_count: int
    warning_count: int

    def to_dict(self) -> dict[str, int]:
        return {
            "packageCount": self.package_count,
            "loadedPackageCount": self.loaded_package_count,
            "partialPackageCount": self.partial_package_count,
            "failedPackageCount": self.failed_package_count,
            "nodeCount": self.node_count,
            "credentialTypeCount": self.credential_type_count,
            "legacyNodeCount": self.legacy_node_count,
            "errorCount": self.error_count,
            "warningCount": self.warning_count,
        }


@dataclass(frozen=True)
class NodeDoctorReport:
    target: Path
    packages: tuple[NodePackageInfo, ...]
    nodes: tuple[RegisteredNodeType, ...]
    diagnostics: tuple[NodePackageDiagnostic, ...]
    summary: NodeDoctorSummary

    @property
    def valid(self) -> bool:
        return self.summary.error_count == 0

    def to_dict(self) -> dict[str, object]:
        return {
            "valid": self.valid,
            "target": str(self.target),
            "summary": self.summary.to_dict(),
            "packages": [package.to_api_dict() for package in self.packages],
            "nodes": [_node_summary(node_type) for node_type in self.nodes],
            "diagnostics": [diagnostic.to_api_dict() for diagnostic in self.diagnostics],
        }


def inspect_node_packages(target: Path) -> NodeDoctorReport:
    nodes_dir = _nodes_directory(target)
    registry = NodeRegistry(nodes_dir=nodes_dir)
    scan = registry.scan()
    nodes = tuple(registry.list_node_types())
    diagnostics = [
        *scan.diagnostics,
        *_default_dynamic_port_diagnostics(nodes),
    ]
    if not nodes:
        diagnostics.append(
            NodePackageDiagnostic(
                code="node_doctor_no_nodes",
                level="error",
                message="目标目录没有成功加载任何节点。",
                path=".",
            )
        )
    ordered_diagnostics = tuple(
        sorted(
            diagnostics,
            key=lambda item: (
                item.level != "error",
                item.package_id or "",
                item.path or "",
                item.entrypoint or "",
                item.code,
            ),
        )
    )
    packages = tuple(scan.packages)
    summary = NodeDoctorSummary(
        package_count=len(packages),
        loaded_package_count=sum(package.status == "loaded" for package in packages),
        partial_package_count=sum(package.status == "partial" for package in packages),
        failed_package_count=sum(package.status == "failed" for package in packages),
        node_count=len(nodes),
        credential_type_count=len(registry.list_credential_types()),
        legacy_node_count=scan.legacy_node_count,
        error_count=sum(diagnostic.level == "error" for diagnostic in ordered_diagnostics),
        warning_count=sum(diagnostic.level == "warning" for diagnostic in ordered_diagnostics),
    )
    return NodeDoctorReport(
        target=nodes_dir.resolve(),
        packages=packages,
        nodes=nodes,
        diagnostics=ordered_diagnostics,
        summary=summary,
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="检查 Node Flow Python 节点包。")
    parser.add_argument(
        "target",
        nargs="?",
        type=Path,
        default=Path("nodes"),
        help="节点目录、节点包目录或 nodeflow-package.json，默认 nodes",
    )
    parser.add_argument("--json", action="store_true", dest="json_output", help="输出机器可读 JSON")
    parser.add_argument("--strict", action="store_true", help="把警告也视为失败")
    args = parser.parse_args(argv)

    try:
        report = inspect_node_packages(args.target)
    except (FileNotFoundError, NotADirectoryError) as exc:
        print(f"节点包自检无法开始：{exc}", file=sys.stderr)
        return 2

    if args.json_output:
        print(json.dumps(report.to_dict(), ensure_ascii=False, indent=2))
    else:
        print_human_report(report)

    return 1 if not report.valid or (args.strict and report.summary.warning_count > 0) else 0


def print_human_report(report: NodeDoctorReport) -> None:
    status = "通过" if report.valid else "失败"
    summary = report.summary
    print(f"节点包自检：{status}")
    print(f"目录：{report.target}")
    print(
        "摘要："
        f"{summary.package_count} 个包，"
        f"{summary.node_count} 个节点，"
        f"{summary.credential_type_count} 个凭据类型，"
        f"{summary.error_count} 个错误，"
        f"{summary.warning_count} 个警告"
    )
    for package in report.packages:
        print(
            f"[{_package_status_label(package.status)}] "
            f"{package.name} ({package.id}) v{package.version}，"
            f"{len(package.node_ids)} 个节点，"
            f"兼容性：{_compatibility_status_label(package.compatibility)}"
        )
    for diagnostic in report.diagnostics:
        location = diagnostic.entrypoint or diagnostic.path or diagnostic.package_id or "全局"
        level = "错误" if diagnostic.level == "error" else "警告"
        print(f"[{level}] {diagnostic.code} · {location} · {diagnostic.message}")


def _nodes_directory(target: Path) -> Path:
    if not target.exists():
        raise FileNotFoundError(f"路径不存在：{target}")
    if target.is_file():
        if target.name != "nodeflow-package.json":
            raise NotADirectoryError(f"仅支持目录或 nodeflow-package.json：{target}")
        return target.parent
    return target


def _default_dynamic_port_diagnostics(
    node_types: tuple[RegisteredNodeType, ...],
) -> list[NodePackageDiagnostic]:
    diagnostics: list[NodePackageDiagnostic] = []
    for node_type in node_types:
        node_class = node_type.node_class
        meta = node_class.__node_meta__
        if meta.dynamic_inputs is None and meta.dynamic_outputs is None:
            continue

        candidate_config: dict[str, object] = {}
        if meta.dynamic_inputs is not None and meta.dynamic_inputs.default_items:
            candidate_config[meta.dynamic_inputs.config_key] = list(meta.dynamic_inputs.default_items)
        if meta.dynamic_outputs is not None and meta.dynamic_outputs.default_items:
            candidate_config[meta.dynamic_outputs.config_key] = list(meta.dynamic_outputs.default_items)
        try:
            config = node_class.config_model().model_validate(
                candidate_config,
                extra="forbid",
            ).model_dump(mode="python")
        except ValidationError:
            diagnostics.append(
                _node_diagnostic(
                    node_type,
                    code="node_dynamic_port_default_check_skipped",
                    level="warning",
                    message=(
                        f"节点 {node_type.id} 的配置模型需要额外必填参数，"
                        "无法只用默认值检查动态端口解析器。"
                    ),
                )
            )
            continue

        node = WorkflowNode(
            id=f"doctor_{node_type.id.replace('.', '_')}",
            type=node_type.id,
            typeVersion=node_type.version,
            position=Position(x=0, y=0),
            config=config,
        )
        for contract in (
            resolve_input_port_contract(node, node_type),
            resolve_output_port_contract(node, node_type),
        ):
            if contract.issue is None:
                continue
            diagnostics.append(
                _node_diagnostic(
                    node_type,
                    code=contract.issue.code,
                    level="error",
                    message=f"节点 {node_type.id}：{contract.issue.message}",
                )
            )
    return diagnostics


def _node_diagnostic(
    node_type: RegisteredNodeType,
    *,
    code: str,
    level: Literal["error", "warning"],
    message: str,
) -> NodePackageDiagnostic:
    return NodePackageDiagnostic(
        code=code,
        level="error" if level == "error" else "warning",
        message=message,
        package_id=node_type.package.id if node_type.package else None,
        path=node_type.id,
    )


def _node_summary(node_type: RegisteredNodeType) -> dict[str, object]:
    return {
        "id": node_type.id,
        "name": node_type.display_name,
        "version": node_type.version,
        "packageId": node_type.package.id if node_type.package else None,
        "staticInputCount": len(node_type.inputs),
        "staticOutputCount": len(node_type.outputs),
        "hasDynamicInputs": node_type.dynamic_inputs is not None,
        "hasDynamicOutputs": node_type.dynamic_outputs is not None,
    }


def _package_status_label(status: str) -> str:
    return {
        "loaded": "通过",
        "partial": "部分可用",
        "failed": "失败",
    }.get(status, status)


def _compatibility_status_label(status: str) -> str:
    return {
        "compatible": "兼容",
        "unverified": "未验证",
        "incompatible": "不兼容",
    }.get(status, status)


if __name__ == "__main__":
    raise SystemExit(main())
