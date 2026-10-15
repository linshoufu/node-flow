from __future__ import annotations

from pydantic import ValidationError

from .node_registry import NodeRegistry
from .node_ports import resolve_input_port_contract, resolve_output_port_contract
from .workflow_dynamic_port_validation import dynamic_port_config_issues
from .schemas import WorkflowNode

NodeIssue = tuple[str, str] | tuple[str, str, str]

CONTROL_NODE_TYPES = {"control.each_item", "control.foreach", "control.while"}


def node_definition_issues(
    node: WorkflowNode,
    registry: NodeRegistry,
    path: str,
    *,
    validate_config: bool = True,
) -> list[NodeIssue]:
    if not registry.has(node.type):
        return [(path, f"Unknown node type: {node.type}")]

    issues: list[NodeIssue] = []
    node_type = registry.get(node.type)
    input_contract = None
    output_contract = None
    if node.typeVersion < node_type.version:
        issues.append(
            (
                f"{path}.typeVersion",
                f"节点 {node.type} 需要从版本 {node.typeVersion} 升级到 {node_type.version}",
            )
        )
    elif node.typeVersion > node_type.version:
        issues.append(
            (
                f"{path}.typeVersion",
                f"节点 {node.type} 保存于版本 {node.typeVersion}，当前脚本只支持到版本 {node_type.version}",
            )
        )
    if validate_config:
        config_is_valid = True
        try:
            node_type.node_class.config_model().model_validate(node.config, extra="forbid")
        except ValidationError as exc:
            config_is_valid = False
            for error in exc.errors():
                field_path = ".".join(str(part) for part in error["loc"])
                if field_path and any(field_path == target or field_path.startswith(target + ".") or target.startswith(field_path + ".") for target in node.configBindings):
                    continue
                issue_path = f"{path}.config" if not field_path else f"{path}.config.{field_path}"
                issues.append((issue_path, error["msg"]))

        if config_is_valid:
            dynamic_issues = dynamic_port_config_issues(node, node_type, path)
            issues.extend(dynamic_issues)
            if not dynamic_issues:
                input_contract = resolve_input_port_contract(node, node_type)
                output_contract = resolve_output_port_contract(node, node_type)
                if input_contract.issue is not None:
                    issues.append(
                        (
                            f"{path}.ports.inputs",
                            input_contract.issue.message,
                            input_contract.issue.code,
                        )
                    )
                if output_contract.issue is not None:
                    issues.append(
                        (
                            f"{path}.ports.outputs",
                            output_contract.issue.message,
                            output_contract.issue.code,
                        )
                    )

        if node.pinnedData is not None:
            if not node.pinnedData:
                issues.append((f"{path}.pinnedData", "固定输出至少需要包含一个输出端口"))
            if output_contract is None:
                output_contract = resolve_output_port_contract(node, node_type)
            output_ports = output_contract.ports
            for output_name in node.pinnedData:
                if output_name not in output_ports:
                    issues.append((f"{path}.pinnedData.{output_name}", f"不存在的输出端口：{output_name}"))

    if node.type in CONTROL_NODE_TYPES and "body" not in node.subflows:
        issues.append((f"{path}.subflows", "Control nodes require a body subflow"))

    return issues
