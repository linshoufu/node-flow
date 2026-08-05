from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, Callable

from nodeflow_sdk import DynamicInputList, DynamicOutputList, Input, Output
from pydantic import BaseModel

from .node_registry import PORT_HANDLE_PATTERN, RegisteredNodeType, validate_port_mapping
from .schemas import WorkflowNode


@dataclass(frozen=True)
class PortResolutionIssue:
    code: str
    message: str


@dataclass(frozen=True)
class ResolvedPortContract:
    ports: dict[str, dict[str, Any]]
    issue: PortResolutionIssue | None = None


def resolve_input_port_contract(node: WorkflowNode, node_type: RegisteredNodeType) -> ResolvedPortContract:
    """Safely resolve and validate one node instance's complete input contract."""

    node_class = node_type.node_class
    return _resolve_port_contract(
        raw_config=node.config,
        config_model=node_class.config_model(),
        resolver=node_class.input_ports,
        static_ports=node_class.inputs,
        dynamic=node_class.__node_meta__.dynamic_inputs,
        expected_type=Input,
        direction="输入",
        code="node_input_port_resolution_failed",
    )


def resolve_output_port_contract(node: WorkflowNode, node_type: RegisteredNodeType) -> ResolvedPortContract:
    """Safely resolve and validate one node instance's complete output contract."""

    node_class = node_type.node_class
    return _resolve_port_contract(
        raw_config=node.config,
        config_model=node_class.config_model(),
        resolver=node_class.output_ports,
        static_ports=node_class.outputs,
        dynamic=node_class.__node_meta__.dynamic_outputs,
        expected_type=Output,
        direction="输出",
        code="node_output_port_resolution_failed",
    )


def resolved_input_ports(node: WorkflowNode, node_type: RegisteredNodeType) -> dict[str, dict[str, Any]]:
    """Return the input contract for one persisted node configuration."""

    return resolve_input_port_contract(node, node_type).ports


def resolved_output_ports(node: WorkflowNode, node_type: RegisteredNodeType) -> dict[str, dict[str, Any]]:
    """Return the output contract for one persisted node configuration."""

    return resolve_output_port_contract(node, node_type).ports


def _resolve_port_contract(
    *,
    raw_config: dict[str, Any],
    config_model: type[BaseModel],
    resolver: Callable[[dict[str, Any]], dict[str, Input] | dict[str, Output]],
    static_ports: dict[str, Input] | dict[str, Output],
    dynamic: DynamicInputList | DynamicOutputList | None,
    expected_type: type[Input] | type[Output],
    direction: str,
    code: str,
) -> ResolvedPortContract:
    try:
        config = config_model.model_validate(raw_config, extra="forbid").model_dump(mode="python")
        resolved_ports = resolver(config)
        validate_port_mapping(resolved_ports, expected_type, direction)
        expected_ports = _expected_port_contract(config, static_ports, dynamic)
        _require_matching_contract(resolved_ports, expected_ports, direction)
        return ResolvedPortContract(ports=_serialize_ports(resolved_ports))
    except Exception as exc:
        error_type = type(exc).__name__
        detail = str(exc).strip()
        suffix = f"：{error_type}" + (f"：{detail}" if detail else "")
        return ResolvedPortContract(
            ports=_serialize_ports(static_ports),
            issue=PortResolutionIssue(
                code=code,
                message=f"节点{direction}端口解析失败{suffix}",
            ),
        )


def _expected_port_contract(
    config: dict[str, Any],
    static_ports: dict[str, Input] | dict[str, Output],
    dynamic: DynamicInputList | DynamicOutputList | None,
) -> dict[str, Input] | dict[str, Output]:
    expected = dict(static_ports)
    if dynamic is None:
        return expected

    entries = config.get(dynamic.config_key)
    if not isinstance(entries, list):
        raise ValueError(f"动态端口配置 {dynamic.config_key!r} 必须是数组")

    prototype = dynamic.input if isinstance(dynamic, DynamicInputList) else dynamic.output
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ValueError(f"动态端口配置 {dynamic.config_key}.{index} 必须是对象")
        handle = entry.get(dynamic.id_key)
        if not isinstance(handle, str) or not PORT_HANDLE_PATTERN.fullmatch(handle):
            raise ValueError(f"动态端口句柄 {handle!r} 不合法")
        if handle in expected:
            raise ValueError(f"动态端口句柄 {handle!r} 重复")
        label = entry.get(dynamic.label_key)
        expected[handle] = (
            replace(prototype, display_name=label.strip())
            if isinstance(label, str) and label.strip()
            else prototype
        )
    return expected


def _require_matching_contract(
    resolved: dict[str, Input] | dict[str, Output],
    expected: dict[str, Input] | dict[str, Output],
    direction: str,
) -> None:
    missing = sorted(set(expected) - set(resolved))
    if missing:
        raise ValueError(f"{direction}端口解析器遗漏了已声明端口：{', '.join(missing)}")
    undeclared = sorted(set(resolved) - set(expected))
    if undeclared:
        raise ValueError(f"{direction}端口解析器返回了未声明端口：{', '.join(undeclared)}")

    mismatched = sorted(handle for handle, port in resolved.items() if port != expected[handle])
    if mismatched:
        raise ValueError(f"{direction}端口运行时定义与声明不一致：{', '.join(mismatched)}")


def _serialize_ports(ports: dict[str, Input] | dict[str, Output]) -> dict[str, dict[str, Any]]:
    return {name: port.to_dict() for name, port in ports.items()}
