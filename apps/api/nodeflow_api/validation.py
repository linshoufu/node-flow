from __future__ import annotations

from collections.abc import Callable, Iterable

from .credential_references import credential_reference_fields
from .credentials import CredentialType, credential_type_by_id
from .node_registry import NodeRegistry
from .node_ports import resolved_input_ports
from .execution_policy import execution_policy_issues
from .schemas import CredentialRecord, ValidationIssue, ValidationResult, WorkflowDocument, WorkflowNode, WorkflowSubflow
from .workflow_connections import (
    EdgeConnectionValidationResult,
    required_input_issues,
    validate_workflow_connections,
)
from .workflow_expression_validation import expression_syntax_issues
from .workflow_node_validation import node_definition_issues
from .workflow_settings import invalid_workflow_setting_issues
from .workflow_schedule_validation import schedule_trigger_issues
from .workflow_structure import cycle_issues, duplicate_edge_id_issues, duplicate_node_id_issues
from .workflow_variables import invalid_workflow_variable_issues
from .workflow_webhook_validation import webhook_trigger_issues
from .run_parameters import parameter_declaration
from .config_bindings import resolve_workflow_bindings


def validate_workflow(
    workflow: WorkflowDocument,
    registry: NodeRegistry,
    *,
    allow_schedule: bool = True,
    credential_lookup: Callable[[str], CredentialRecord | None] | None = None,
    credential_type_lookup: Callable[[str], CredentialType | None] = credential_type_by_id,
    error_workflow_lookup: Callable[[str], WorkflowDocument | None] | None = None,
    item_loop_body: bool = False,
    _bindings_resolved: bool = False,
) -> ValidationResult:
    issues: list[ValidationIssue] = []
    if not _bindings_resolved:
        try:
            workflow = resolve_workflow_bindings(workflow, registry)
        except ValueError as exc:
            return ValidationResult(valid=False, issues=[ValidationIssue(path="configuration", message=str(exc), code="config_binding_invalid")])
    try:
        parameter_declaration(workflow)
    except ValueError as exc:
        issues.append(ValidationIssue(path="nodes", message=str(exc), code="run_parameters_invalid"))
    node_by_id = {node.id: node for node in workflow.nodes}
    _add_issues(issues, duplicate_node_id_issues(workflow.nodes))
    _add_issues(issues, duplicate_edge_id_issues(workflow.edges))
    _validate_workflow_settings(workflow, issues, error_workflow_lookup=error_workflow_lookup)
    for node in workflow.nodes:
        if node.type in {"control.loop_input", "control.loop_output"} and not item_loop_body:
            issues.append(ValidationIssue(path=f"nodes.{node.id}", message="循环输入和循环结果只能放在逐项循环体中", code="loop_boundary_outside_body"))
        if node.type in {"control.each_item", "control.foreach"}:
            returns = [child for child in node.subflows.get("body", WorkflowSubflow()).nodes
                       if child.type == "control.loop_output"]
            if len(returns) > 1:
                issues.append(ValidationIssue(path=f"nodes.{node.id}", message="逐项循环体只能声明一个循环结果节点", code="loop_multiple_outputs"))
            if any(edge.source == node.id and edge.sourceHandle == "results" for edge in workflow.edges) and not returns:
                issues.append(ValidationIssue(path=f"nodes.{node.id}", message="使用逐项结果端口时，循环体必须包含循环结果节点", code="loop_output_required"))
        _validate_node(
            node,
            registry,
            f"nodes.{node.id}",
            issues,
            credential_lookup=credential_lookup,
            credential_type_lookup=credential_type_lookup,
        )
        if not node.disabled:
            _add_issues(
                issues,
                execution_policy_issues(node, workflow.edges, registry, f"nodes.{node.id}"),
            )
    for connection_issue in validate_workflow_connections(workflow.edges, node_by_id, registry):
        issues.append(
            ValidationIssue(
                path=connection_issue.path,
                message=connection_issue.result.message,
                code=connection_issue.result.code.value if connection_issue.result.code else None,
                details=_connection_validation_details(connection_issue.result),
            )
        )
    _add_issues(issues, required_input_issues(workflow.nodes, workflow.edges, node_by_id, registry))
    _add_issues(issues, cycle_issues(workflow.nodes, workflow.edges))
    _add_issues(issues, webhook_trigger_issues(workflow.nodes, workflow.edges))
    _add_issues(
        issues,
        schedule_trigger_issues(workflow.nodes, workflow.edges, allow_schedule=allow_schedule),
    )
    for node in workflow.nodes:
        for subflow_name, subflow in node.subflows.items():
            nested = WorkflowDocument(
                id=f"{workflow.id}:{node.id}:{subflow_name}",
                name=f"{workflow.name} {node.id} {subflow_name}",
                nodes=subflow.nodes,
                edges=subflow.edges,
            )
            nested_result = validate_workflow(
                nested,
                registry,
                allow_schedule=False,
                credential_lookup=credential_lookup,
                credential_type_lookup=credential_type_lookup,
                error_workflow_lookup=error_workflow_lookup,
                item_loop_body=node.type in {"control.each_item", "control.foreach"} and subflow_name == "body",
                _bindings_resolved=True,
            )
            for issue in nested_result.issues:
                issues.append(
                    ValidationIssue(
                        path=f"nodes.{node.id}.subflows.{subflow_name}.{issue.path}",
                        message=issue.message,
                        code=issue.code,
                        details=issue.details,
                    )
                )
    return ValidationResult(valid=not issues, issues=issues)


def manual_run_entry_issues(
    workflow: WorkflowDocument,
    registry: NodeRegistry,
    entry_node_id: str | None,
    *, allow_pinned_data: bool = True,
) -> list[ValidationIssue]:
    """Validate the extra boundary created when an editor starts from one node.

    A manual entry intentionally ignores incoming workflow edges. Required inputs
    on that entry node would therefore be silently empty without this check.
    """
    if entry_node_id is None:
        return []

    node = next((candidate for candidate in workflow.nodes if candidate.id == entry_node_id), None)
    if node is None:
        return [
            ValidationIssue(
                path="entry_node_id",
                message=f"未找到要开始运行的节点：{entry_node_id}",
                code="manual_run_entry_missing",
            )
        ]
    if node.disabled:
        return []
    if not registry.has(node.type):
        return []

    node_type = registry.get(node.type)
    node_by_id = {candidate.id: candidate for candidate in workflow.nodes}
    pinned_input_handles = {
        edge.targetHandle
        for edge in workflow.edges
        if edge.target == node.id
        and (source := node_by_id.get(edge.source)) is not None
        and source.pinnedData is not None
        and allow_pinned_data
        and edge.sourceHandle in source.pinnedData
    }
    issues: list[ValidationIssue] = []
    for input_name, input_meta in resolved_input_ports(node, node_type).items():
        if not input_meta.get("required", False) or input_name in pinned_input_handles:
            continue
        display_name = input_meta.get("displayName")
        input_label = display_name if isinstance(display_name, str) and display_name else input_name
        issues.append(
            ValidationIssue(
                path=f"nodes.{node.id}.inputs.{input_name}",
                message=(
                    f"从此节点开始运行时，必填输入“{input_label}”不会自动使用上游数据。"
                    "请改为完整运行，或先调整为可独立运行的节点。"
                ),
                code="manual_run_required_input",
            )
        )
    return issues


def _validate_workflow_settings(
    workflow: WorkflowDocument,
    issues: list[ValidationIssue],
    *,
    error_workflow_lookup: Callable[[str], WorkflowDocument | None] | None,
) -> None:
    for path, message in invalid_workflow_setting_issues(
        workflow.settings.timeout_seconds,
        workflow.settings.max_concurrent_runs,
    ):
        issues.append(ValidationIssue(path=path, message=message))

    for path, message in invalid_workflow_variable_issues(workflow.settings.variables):
        issues.append(ValidationIssue(path=path, message=message))

    error_workflow_id = workflow.settings.error_workflow_id
    if not error_workflow_id:
        return
    if error_workflow_id == workflow.id:
        issues.append(
            ValidationIssue(
                path="settings.error_workflow_id",
                message="错误处理工作流不能引用自身。",
                code="error_workflow_self_reference",
            )
        )
        return
    error_workflow = error_workflow_lookup(error_workflow_id) if error_workflow_lookup is not None else None
    if error_workflow_lookup is not None and error_workflow is None:
        issues.append(
            ValidationIssue(
                path="settings.error_workflow_id",
                message="引用的错误处理工作流不存在或已删除。",
                code="error_workflow_not_found",
            )
        )
        return
    if error_workflow is not None and not _starts_with_workflow_trigger(error_workflow):
        issues.append(
            ValidationIssue(
                path="settings.error_workflow_id",
                message="错误处理工作流必须仅以一个“工作流触发”节点开始。",
                code="error_workflow_invalid_trigger",
            )
        )


def _starts_with_workflow_trigger(workflow: WorkflowDocument) -> bool:
    incoming_targets = {edge.target for edge in workflow.edges}
    root_nodes = [node for node in workflow.nodes if node.id not in incoming_targets]
    trigger_nodes = [node for node in workflow.nodes if node.type == "workflow.trigger"]
    return len(trigger_nodes) == 1 and len(root_nodes) == 1 and root_nodes[0].id == trigger_nodes[0].id


def _add_issues(
    issues: list[ValidationIssue],
    new_issues: Iterable[tuple[str, str] | tuple[str, str, str]],
) -> None:
    for issue in new_issues:
        path, message = issue[:2]
        code = issue[2] if len(issue) == 3 else None
        issues.append(ValidationIssue(path=path, message=message, code=code))


def _validate_node(
    node: WorkflowNode,
    registry: NodeRegistry,
    path: str,
    issues: list[ValidationIssue],
    *,
    credential_lookup: Callable[[str], CredentialRecord | None] | None,
    credential_type_lookup: Callable[[str], CredentialType | None],
) -> None:
    _add_issues(issues, node_definition_issues(node, registry, path, validate_config=not node.disabled))
    if node.disabled:
        return
    _add_issues(issues, expression_syntax_issues(node.config, f"{path}.config"))
    if credential_lookup is not None:
        _validate_credential_reference(
            node,
            registry,
            path,
            issues,
            credential_lookup,
            credential_type_lookup,
        )


def _validate_credential_reference(
    node: WorkflowNode,
    registry: NodeRegistry,
    path: str,
    issues: list[ValidationIssue],
    credential_lookup: Callable[[str], CredentialRecord | None],
    credential_type_lookup: Callable[[str], CredentialType | None],
) -> None:
    node_type = registry.get(node.type) if registry.has(node.type) else None
    form = node_type.form if node_type is not None else None
    for field_name, credential_id, allowed_type_ids in credential_reference_fields(node.config, form):
        credential = credential_lookup(credential_id)
        credential_path = f"{path}.config.{field_name}"
        if credential is None:
            issues.append(
                ValidationIssue(
                    path=credential_path,
                    message="引用的凭据不存在或已删除。",
                    code="credential_not_found",
                )
            )
            continue

        credential_type = credential_type_lookup(credential.type_id)
        if (
            credential_type is None
            or node.type not in credential_type.node_type_ids
            or (allowed_type_ids and credential.type_id not in allowed_type_ids)
        ):
            issues.append(
                ValidationIssue(
                    path=credential_path,
                    message="该节点不能使用所选凭据类型。",
                    code="credential_type_mismatch",
                )
            )


def _connection_validation_details(result: EdgeConnectionValidationResult) -> dict[str, str] | None:
    details = {
        key: value
        for key, value in {
            "source_port": result.source_port,
            "target_port": result.target_port,
            "source_schema_label": result.source_schema_label,
            "target_schema_label": result.target_schema_label,
            "source_connection_kind": result.source_connection_kind,
            "target_connection_kind": result.target_connection_kind,
        }.items()
        if value is not None
    }
    return details or None
