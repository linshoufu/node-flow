from __future__ import annotations

import re
from typing import Any

from .node_registry import RegisteredNodeType
from .schemas import WorkflowNode

PORT_HANDLE_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def dynamic_port_config_issues(
    node: WorkflowNode,
    node_type: RegisteredNodeType,
    path: str,
) -> list[tuple[str, str]]:
    issues: list[tuple[str, str]] = []
    issues.extend(
        _dynamic_port_config_issues(
            node.config,
            node_type.dynamic_inputs,
            node_type.inputs,
            path,
            "输入",
        )
    )
    issues.extend(
        _dynamic_port_config_issues(
            node.config,
            node_type.dynamic_outputs,
            node_type.outputs,
            path,
            "输出",
        )
    )
    return issues


def _dynamic_port_config_issues(
    config: dict[str, Any],
    dynamic: dict[str, Any] | None,
    static_ports: dict[str, dict[str, Any]],
    path: str,
    direction: str,
) -> list[tuple[str, str]]:
    if not dynamic:
        return []
    config_key = dynamic.get("configKey")
    id_key = dynamic.get("idKey")
    label_key = dynamic.get("labelKey")
    if not all(isinstance(value, str) and value for value in (config_key, id_key, label_key)):
        return []
    if config_key not in config:
        return []

    value = config[config_key]
    config_path = f"{path}.config.{config_key}"
    if not isinstance(value, list):
        return [(config_path, f"动态{direction}端口配置必须是数组")]

    issues: list[tuple[str, str]] = []
    seen_ids = set(static_ports)
    for index, entry in enumerate(value):
        entry_path = f"{config_path}.{index}"
        if not isinstance(entry, dict):
            issues.append((entry_path, f"动态{direction}端口配置项必须是对象"))
            continue
        port_id = entry.get(id_key)
        id_path = f"{entry_path}.{id_key}"
        if not isinstance(port_id, str) or not PORT_HANDLE_PATTERN.fullmatch(port_id):
            issues.append((id_path, f"动态{direction}端口 ID 必须匹配 {PORT_HANDLE_PATTERN.pattern}"))
            continue
        if port_id in seen_ids:
            issues.append((id_path, f"动态{direction}端口 ID {port_id!r} 与已有端口重复"))
            continue
        seen_ids.add(port_id)

        if label_key in entry and (
            not isinstance(entry[label_key], str) or not entry[label_key].strip()
        ):
            issues.append((f"{entry_path}.{label_key}", f"动态{direction}端口名称必须是非空字符串"))
    return issues
