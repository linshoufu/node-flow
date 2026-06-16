from __future__ import annotations

from pydantic import ValidationError

from .node_registry import NodeRegistry
from .schemas import ValidationIssue, ValidationResult, WorkflowDocument, WorkflowEdge, WorkflowNode


CONTROL_NODE_TYPES = {"control.foreach", "control.while"}


def validate_workflow(workflow: WorkflowDocument, registry: NodeRegistry) -> ValidationResult:
    issues: list[ValidationIssue] = []
    node_by_id = {node.id: node for node in workflow.nodes}
    if len(node_by_id) != len(workflow.nodes):
        issues.append(ValidationIssue(path="nodes", message="Node IDs must be unique"))
    for node in workflow.nodes:
        _validate_node(node, registry, f"nodes.{node.id}", issues)
    for edge in workflow.edges:
        _validate_edge(edge, node_by_id, registry, issues)
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
        issues.append(ValidationIssue(path=f"{path}.config", message=str(exc)))
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
        return
    if target is None:
        issues.append(
            ValidationIssue(path=f"edges.{edge.id}.target", message=f"Unknown target node: {edge.target}")
        )
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


def _validate_no_cycles(
    nodes: list[WorkflowNode],
    edges: list[WorkflowEdge],
    issues: list[ValidationIssue],
) -> None:
    graph: dict[str, list[str]] = {node.id: [] for node in nodes}
    for edge in edges:
        if edge.source in graph and edge.target in graph:
            graph[edge.source].append(edge.target)
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str) -> bool:
        if node_id in visiting:
            return True
        if node_id in visited:
            return False
        visiting.add(node_id)
        for target in graph[node_id]:
            if visit(target):
                return True
        visiting.remove(node_id)
        visited.add(node_id)
        return False

    for node_id in graph:
        if visit(node_id):
            issues.append(ValidationIssue(path="edges", message="Workflow graph contains a cycle"))
            return
