from __future__ import annotations

from collections import deque

from pydantic import ValidationError

from .expressions import invalid_expression_tokens
from .node_registry import NodeRegistry
from .schemas import ValidationIssue, ValidationResult, WorkflowDocument, WorkflowEdge, WorkflowNode


CONTROL_NODE_TYPES = {"control.foreach", "control.while"}


def validate_workflow(workflow: WorkflowDocument, registry: NodeRegistry) -> ValidationResult:
    issues: list[ValidationIssue] = []
    node_by_id = {node.id: node for node in workflow.nodes}
    if len(node_by_id) != len(workflow.nodes):
        issues.append(ValidationIssue(path="nodes", message="Node IDs must be unique"))
    edge_by_id = {edge.id: edge for edge in workflow.edges}
    if len(edge_by_id) != len(workflow.edges):
        issues.append(ValidationIssue(path="edges", message="Edge IDs must be unique"))
    for node in workflow.nodes:
        _validate_node(node, registry, f"nodes.{node.id}", issues)
    for edge in workflow.edges:
        _validate_edge(edge, node_by_id, registry, issues)
    _validate_required_inputs(workflow.nodes, workflow.edges, node_by_id, registry, issues)
    _validate_no_cycles(workflow.nodes, workflow.edges, issues)
    for node in workflow.nodes:
        for subflow_name, subflow in node.subflows.items():
            nested = WorkflowDocument(
                id=f"{workflow.id}:{node.id}:{subflow_name}",
                name=f"{workflow.name} {node.id} {subflow_name}",
                nodes=subflow.nodes,
                edges=subflow.edges,
            )
            nested_result = validate_workflow(nested, registry)
            for issue in nested_result.issues:
                issues.append(
                    ValidationIssue(
                        path=f"nodes.{node.id}.subflows.{subflow_name}.{issue.path}",
                        message=issue.message,
                    )
                )
    return ValidationResult(valid=not issues, issues=issues)


def _validate_node(
    node: WorkflowNode,
    registry: NodeRegistry,
    path: str,
    issues: list[ValidationIssue],
) -> None:
    if not registry.has(node.type):
        issues.append(ValidationIssue(path=path, message=f"Unknown node type: {node.type}"))
        return
    node_type = registry.get(node.type)
    try:
        node_type.node_class.config_model().model_validate(node.config, extra="forbid")
    except ValidationError as exc:
        for error in exc.errors():
            field_path = ".".join(str(part) for part in error["loc"])
            issue_path = f"{path}.config" if not field_path else f"{path}.config.{field_path}"
            issues.append(ValidationIssue(path=issue_path, message=error["msg"]))
    _validate_expression_syntax(node.config, f"{path}.config", issues)
    if node.type in CONTROL_NODE_TYPES and "body" not in node.subflows:
        issues.append(
            ValidationIssue(path=f"{path}.subflows", message="Control nodes require a body subflow")
        )


def _validate_edge(
    edge: WorkflowEdge,
    node_by_id: dict[str, WorkflowNode],
    registry: NodeRegistry,
    issues: list[ValidationIssue],
) -> None:
    source = node_by_id.get(edge.source)
    target = node_by_id.get(edge.target)
    if source is None:
        issues.append(
            ValidationIssue(path=f"edges.{edge.id}.source", message=f"Unknown source node: {edge.source}")
        )
    if target is None:
        issues.append(
            ValidationIssue(path=f"edges.{edge.id}.target", message=f"Unknown target node: {edge.target}")
        )
    if source is None or target is None:
        return
    if not registry.has(source.type) or not registry.has(target.type):
        return
    source_type = registry.get(source.type)
    target_type = registry.get(target.type)
    if edge.sourceHandle not in source_type.outputs:
        issues.append(
            ValidationIssue(
                path=f"edges.{edge.id}.sourceHandle",
                message=f"Unknown source handle: {edge.sourceHandle}",
            )
        )
    if edge.targetHandle not in target_type.inputs:
        issues.append(
            ValidationIssue(
                path=f"edges.{edge.id}.targetHandle",
                message=f"Unknown target handle: {edge.targetHandle}",
            )
        )


def _validate_required_inputs(
    nodes: list[WorkflowNode],
    edges: list[WorkflowEdge],
    node_by_id: dict[str, WorkflowNode],
    registry: NodeRegistry,
    issues: list[ValidationIssue],
) -> None:
    connected_handles = {
        (edge.target, edge.targetHandle) for edge in edges if edge.target in node_by_id
    }
    for node in nodes:
        if not registry.has(node.type):
            continue
        node_type = registry.get(node.type)
        for input_name, input_meta in node_type.inputs.items():
            if input_meta.get("required", True) and (
                node.id,
                input_name,
            ) not in connected_handles:
                issues.append(
                    ValidationIssue(
                        path=f"nodes.{node.id}.inputs.{input_name}",
                        message=f"Missing required input: {input_name}",
                    )
                )


def _validate_no_cycles(
    nodes: list[WorkflowNode],
    edges: list[WorkflowEdge],
    issues: list[ValidationIssue],
) -> None:
    graph: dict[str, list[str]] = {node.id: [] for node in nodes}
    indegree: dict[str, int] = {node.id: 0 for node in nodes}
    for edge in edges:
        if edge.source in graph and edge.target in graph:
            graph[edge.source].append(edge.target)
            indegree[edge.target] += 1

    queue = deque(node_id for node_id, count in indegree.items() if count == 0)
    visited_count = 0
    while queue:
        node_id = queue.popleft()
        visited_count += 1
        for target in graph[node_id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)

    if visited_count != len(graph):
        issues.append(ValidationIssue(path="edges", message="Workflow graph contains a cycle"))


def _validate_expression_syntax(
    value: object,
    path: str,
    issues: list[ValidationIssue],
) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            _validate_expression_syntax(item, f"{path}.{key}", issues)
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _validate_expression_syntax(item, f"{path}.{index}", issues)
        return
    if not isinstance(value, str):
        return

    for token in invalid_expression_tokens(value):
        issues.append(ValidationIssue(path=path, message=f"Invalid expression syntax: {token}"))
