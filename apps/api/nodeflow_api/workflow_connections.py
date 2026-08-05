from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from .node_registry import NodeRegistry
from .node_ports import resolved_input_ports, resolved_output_ports
from .port_schema import schema_type_label, schemas_are_compatible
from .schemas import WorkflowEdge, WorkflowNode

ConnectionIssue = tuple[str, str]


class ConnectionValidationCode(StrEnum):
    UNKNOWN_SOURCE_NODE = "unknown_source_node"
    UNKNOWN_TARGET_NODE = "unknown_target_node"
    UNKNOWN_SOURCE_TYPE = "unknown_source_type"
    UNKNOWN_TARGET_TYPE = "unknown_target_type"
    UNKNOWN_SOURCE_PORT = "unknown_source_port"
    UNKNOWN_TARGET_PORT = "unknown_target_port"
    DUPLICATE_CONNECTION = "duplicate_connection"
    INPUT_ALREADY_CONNECTED = "input_already_connected"
    OUTPUT_CONNECTION_LIMIT_REACHED = "output_connection_limit_reached"
    INCOMPATIBLE_CONNECTION_KIND = "incompatible_connection_kind"
    OUTPUT_PORT_FILTER_REJECTED = "output_port_filter_rejected"
    INPUT_PORT_FILTER_REJECTED = "input_port_filter_rejected"
    INCOMPATIBLE_SCHEMA = "incompatible_schema"


@dataclass(frozen=True)
class EdgeConnectionValidationResult:
    valid: bool
    code: ConnectionValidationCode | None = None
    message: str = ""
    source_port: str | None = None
    target_port: str | None = None
    source_schema_label: str | None = None
    target_schema_label: str | None = None
    source_connection_kind: str | None = None
    target_connection_kind: str | None = None


@dataclass(frozen=True)
class WorkflowConnectionValidationIssue:
    path: str
    result: EdgeConnectionValidationResult


def validate_edge_connection(
    edge: WorkflowEdge,
    node_by_id: dict[str, WorkflowNode],
    registry: NodeRegistry,
    *,
    existing_edges: list[WorkflowEdge],
) -> EdgeConnectionValidationResult:
    source = node_by_id.get(edge.source)
    target = node_by_id.get(edge.target)
    if source is None:
        return _invalid(
            ConnectionValidationCode.UNKNOWN_SOURCE_NODE,
            f"Unknown source node: {edge.source}",
        )
    if target is None:
        return _invalid(
            ConnectionValidationCode.UNKNOWN_TARGET_NODE,
            f"Unknown target node: {edge.target}",
        )
    if not registry.has(source.type):
        return _invalid(
            ConnectionValidationCode.UNKNOWN_SOURCE_TYPE,
            f"Unknown source node type: {source.type}",
        )
    if not registry.has(target.type):
        return _invalid(
            ConnectionValidationCode.UNKNOWN_TARGET_TYPE,
            f"Unknown target node type: {target.type}",
        )

    duplicate_edge = next(
        (
            existing_edge
            for existing_edge in existing_edges
            if existing_edge.id != edge.id
            and existing_edge.source == edge.source
            and existing_edge.sourceHandle == edge.sourceHandle
            and existing_edge.target == edge.target
            and existing_edge.targetHandle == edge.targetHandle
        ),
        None,
    )
    if duplicate_edge is not None:
        return _invalid(
            ConnectionValidationCode.DUPLICATE_CONNECTION,
            f"Duplicate edge connection: {edge.source}.{edge.sourceHandle} -> {edge.target}.{edge.targetHandle}",
            source_port=edge.sourceHandle,
            target_port=edge.targetHandle,
        )

    source_type = registry.get(source.type)
    target_type = registry.get(target.type)
    source_port = resolved_output_ports(source, source_type).get(edge.sourceHandle)
    target_port = resolved_input_ports(target, target_type).get(edge.targetHandle)
    if source_port is None:
        return _invalid(
            ConnectionValidationCode.UNKNOWN_SOURCE_PORT,
            f"Unknown source handle: {edge.sourceHandle}",
            source_port=edge.sourceHandle,
            target_port=edge.targetHandle,
        )
    if target_port is None:
        return _invalid(
            ConnectionValidationCode.UNKNOWN_TARGET_PORT,
            f"Unknown target handle: {edge.targetHandle}",
            source_port=edge.sourceHandle,
            target_port=edge.targetHandle,
        )

    if not port_allows_node_type(source_port, target.type):
        return _invalid(
            ConnectionValidationCode.OUTPUT_PORT_FILTER_REJECTED,
            (
                f"Output port filter rejects target node type: "
                f"{edge.source}.{edge.sourceHandle} -> {target.type}"
            ),
            source_port=edge.sourceHandle,
            target_port=edge.targetHandle,
        )
    if not port_allows_node_type(target_port, source.type):
        return _invalid(
            ConnectionValidationCode.INPUT_PORT_FILTER_REJECTED,
            (
                f"Input port filter rejects source node type: "
                f"{source.type} -> {edge.target}.{edge.targetHandle}"
            ),
            source_port=edge.sourceHandle,
            target_port=edge.targetHandle,
        )

    source_connection_kind = connection_kind(source_port)
    target_connection_kind = connection_kind(target_port)
    if source_connection_kind != target_connection_kind:
        return _invalid(
            ConnectionValidationCode.INCOMPATIBLE_CONNECTION_KIND,
            (
                f"Incompatible connection kinds: {edge.source}.{edge.sourceHandle} "
                f"{source_connection_kind} -> {edge.target}.{edge.targetHandle} "
                f"{target_connection_kind}"
            ),
            source_port=edge.sourceHandle,
            target_port=edge.targetHandle,
            source_connection_kind=source_connection_kind,
            target_connection_kind=target_connection_kind,
        )

    existing_output_count = sum(
        1
        for existing_edge in existing_edges
        if existing_edge.id != edge.id
        and existing_edge.source == edge.source
        and existing_edge.sourceHandle == edge.sourceHandle
    )
    max_output_connections = output_max_connections(source_port)
    if max_output_connections is not None and existing_output_count >= max_output_connections:
        return _invalid(
            ConnectionValidationCode.OUTPUT_CONNECTION_LIMIT_REACHED,
            f"Output handle connection limit reached: {edge.source}.{edge.sourceHandle}",
            source_port=edge.sourceHandle,
            target_port=edge.targetHandle,
        )

    existing_input_count = sum(
        1
        for existing_edge in existing_edges
        if existing_edge.id != edge.id
        and existing_edge.target == edge.target
        and existing_edge.targetHandle == edge.targetHandle
    )
    max_connections = input_max_connections(target_port)
    if max_connections is not None and existing_input_count >= max_connections:
        return _invalid(
            ConnectionValidationCode.INPUT_ALREADY_CONNECTED,
            f"Input handle already connected: {edge.target}.{edge.targetHandle}",
            source_port=edge.sourceHandle,
            target_port=edge.targetHandle,
        )

    source_schema = source_port.get("schema")
    target_schema = target_port.get("schema")
    source_schema_label = schema_type_label(source_schema)
    target_schema_label = schema_type_label(target_schema)
    if not schemas_are_compatible(source_schema, target_schema):
        return _invalid(
            ConnectionValidationCode.INCOMPATIBLE_SCHEMA,
            (
                f"Incompatible port schemas: {edge.source}.{edge.sourceHandle} "
                f"{source_schema_label} -> {edge.target}.{edge.targetHandle} "
                f"{target_schema_label}"
            ),
            source_port=edge.sourceHandle,
            target_port=edge.targetHandle,
            source_schema_label=source_schema_label,
            target_schema_label=target_schema_label,
        )

    return EdgeConnectionValidationResult(valid=True)


def input_max_connections(input_meta: dict[str, Any]) -> int | None:
    value = input_meta.get("maxConnections", 1)
    if value is None:
        return None
    if isinstance(value, int):
        return value
    return 1


def output_max_connections(output_meta: dict[str, Any]) -> int | None:
    value = output_meta.get("maxConnections")
    if value is None:
        return None
    if isinstance(value, int):
        return value
    return None


def connection_kind(port_meta: dict[str, Any]) -> str:
    value = port_meta.get("connectionKind")
    return value if isinstance(value, str) and value else "data"


def port_allows_node_type(port_meta: dict[str, Any], node_type_id: str) -> bool:
    """Apply the SDK's allow/exclude node-type filter to the opposite endpoint."""
    port_filter = port_meta.get("filter")
    if not isinstance(port_filter, dict):
        return True

    allowed = _filter_node_type_ids(port_filter.get("nodes"))
    excluded = _filter_node_type_ids(port_filter.get("excludedNodes"))
    if node_type_id in excluded:
        return False
    return not allowed or node_type_id in allowed


def _filter_node_type_ids(value: Any) -> set[str]:
    if not isinstance(value, list):
        return set()
    return {item for item in value if isinstance(item, str) and item}


def _invalid(
    code: ConnectionValidationCode,
    message: str,
    *,
    source_port: str | None = None,
    target_port: str | None = None,
    source_schema_label: str | None = None,
    target_schema_label: str | None = None,
    source_connection_kind: str | None = None,
    target_connection_kind: str | None = None,
) -> EdgeConnectionValidationResult:
    return EdgeConnectionValidationResult(
        valid=False,
        code=code,
        message=message,
        source_port=source_port,
        target_port=target_port,
        source_schema_label=source_schema_label,
        target_schema_label=target_schema_label,
        source_connection_kind=source_connection_kind,
        target_connection_kind=target_connection_kind,
    )


def validate_workflow_connections(
    edges: list[WorkflowEdge],
    node_by_id: dict[str, WorkflowNode],
    registry: NodeRegistry,
) -> list[WorkflowConnectionValidationIssue]:
    issues: list[WorkflowConnectionValidationIssue] = []
    for index, edge in enumerate(edges):
        missing_node_issues = _missing_endpoint_node_issues(edge, node_by_id)
        if missing_node_issues:
            issues.extend(missing_node_issues)
            continue

        result = validate_edge_connection(edge, node_by_id, registry, existing_edges=edges[:index])
        if result.valid or result.code is None:
            continue

        if result.code in {
            ConnectionValidationCode.UNKNOWN_SOURCE_PORT,
            ConnectionValidationCode.UNKNOWN_TARGET_PORT,
        }:
            issues.extend(_unknown_endpoint_port_issues(edge, node_by_id, registry))
            continue

        path = _workflow_connection_issue_path(edge, result.code)
        if path is not None:
            issues.append(WorkflowConnectionValidationIssue(path=path, result=result))
    return issues


def _missing_endpoint_node_issues(
    edge: WorkflowEdge,
    node_by_id: dict[str, WorkflowNode],
) -> list[WorkflowConnectionValidationIssue]:
    issues: list[WorkflowConnectionValidationIssue] = []
    if edge.source not in node_by_id:
        issues.append(
            WorkflowConnectionValidationIssue(
                path=f"edges.{edge.id}.source",
                result=_invalid(
                    ConnectionValidationCode.UNKNOWN_SOURCE_NODE,
                    f"Unknown source node: {edge.source}",
                ),
            )
        )
    if edge.target not in node_by_id:
        issues.append(
            WorkflowConnectionValidationIssue(
                path=f"edges.{edge.id}.target",
                result=_invalid(
                    ConnectionValidationCode.UNKNOWN_TARGET_NODE,
                    f"Unknown target node: {edge.target}",
                ),
            )
        )
    return issues


def _unknown_endpoint_port_issues(
    edge: WorkflowEdge,
    node_by_id: dict[str, WorkflowNode],
    registry: NodeRegistry,
) -> list[WorkflowConnectionValidationIssue]:
    source = node_by_id[edge.source]
    target = node_by_id[edge.target]
    if not registry.has(source.type) or not registry.has(target.type):
        return []

    issues: list[WorkflowConnectionValidationIssue] = []
    source_type = registry.get(source.type)
    target_type = registry.get(target.type)
    if edge.sourceHandle not in resolved_output_ports(source, source_type):
        issues.append(
            WorkflowConnectionValidationIssue(
                path=f"edges.{edge.id}.sourceHandle",
                result=_invalid(
                    ConnectionValidationCode.UNKNOWN_SOURCE_PORT,
                    f"Unknown source handle: {edge.sourceHandle}",
                    source_port=edge.sourceHandle,
                    target_port=edge.targetHandle,
                ),
            )
        )
    if edge.targetHandle not in resolved_input_ports(target, target_type):
        issues.append(
            WorkflowConnectionValidationIssue(
                path=f"edges.{edge.id}.targetHandle",
                result=_invalid(
                    ConnectionValidationCode.UNKNOWN_TARGET_PORT,
                    f"Unknown target handle: {edge.targetHandle}",
                    source_port=edge.sourceHandle,
                    target_port=edge.targetHandle,
                ),
            )
        )
    return issues


def _workflow_connection_issue_path(edge: WorkflowEdge, code: ConnectionValidationCode) -> str | None:
    if code == ConnectionValidationCode.UNKNOWN_SOURCE_TYPE:
        return None
    if code == ConnectionValidationCode.UNKNOWN_TARGET_TYPE:
        return None
    return {
        ConnectionValidationCode.UNKNOWN_SOURCE_NODE: f"edges.{edge.id}.source",
        ConnectionValidationCode.UNKNOWN_TARGET_NODE: f"edges.{edge.id}.target",
        ConnectionValidationCode.UNKNOWN_SOURCE_PORT: f"edges.{edge.id}.sourceHandle",
        ConnectionValidationCode.UNKNOWN_TARGET_PORT: f"edges.{edge.id}.targetHandle",
        ConnectionValidationCode.DUPLICATE_CONNECTION: f"edges.{edge.id}",
        ConnectionValidationCode.INPUT_ALREADY_CONNECTED: f"edges.{edge.id}.targetHandle",
        ConnectionValidationCode.OUTPUT_CONNECTION_LIMIT_REACHED: f"edges.{edge.id}.sourceHandle",
        ConnectionValidationCode.INCOMPATIBLE_CONNECTION_KIND: f"edges.{edge.id}",
        ConnectionValidationCode.OUTPUT_PORT_FILTER_REJECTED: f"edges.{edge.id}",
        ConnectionValidationCode.INPUT_PORT_FILTER_REJECTED: f"edges.{edge.id}",
        ConnectionValidationCode.INCOMPATIBLE_SCHEMA: f"edges.{edge.id}",
    }[code]


def valid_connected_input_handles(
    edges: list[WorkflowEdge],
    node_by_id: dict[str, WorkflowNode],
    registry: NodeRegistry,
) -> set[tuple[str, str]]:
    connected_handles: set[tuple[str, str]] = set()
    seen_connections: set[tuple[str, str, str, str]] = set()

    for edge in edges:
        source = node_by_id.get(edge.source)
        target = node_by_id.get(edge.target)
        if source is None or target is None:
            continue
        if not registry.has(source.type) or not registry.has(target.type):
            continue

        source_type = registry.get(source.type)
        target_type = registry.get(target.type)
        source_port = resolved_output_ports(source, source_type).get(edge.sourceHandle)
        target_port = resolved_input_ports(target, target_type).get(edge.targetHandle)
        if source_port is None or target_port is None:
            continue

        connection = (edge.source, edge.sourceHandle, edge.target, edge.targetHandle)
        target_handle = (edge.target, edge.targetHandle)
        if connection in seen_connections or target_handle in connected_handles:
            continue
        seen_connections.add(connection)

        if connection_kind(source_port) != connection_kind(target_port):
            continue

        if not port_allows_node_type(source_port, target.type):
            continue
        if not port_allows_node_type(target_port, source.type):
            continue

        if schemas_are_compatible(source_port.get("schema"), target_port.get("schema")):
            connected_handles.add(target_handle)

    return connected_handles


def required_input_issues(
    nodes: list[WorkflowNode],
    edges: list[WorkflowEdge],
    node_by_id: dict[str, WorkflowNode],
    registry: NodeRegistry,
) -> list[ConnectionIssue]:
    issues: list[ConnectionIssue] = []
    connected_handles = valid_connected_input_handles(edges, node_by_id, registry)
    for node in nodes:
        if node.disabled or not registry.has(node.type):
            continue
        node_type = registry.get(node.type)
        for input_name, input_meta in resolved_input_ports(node, node_type).items():
            if input_meta.get("required", True) and (node.id, input_name) not in connected_handles:
                issues.append(
                    (
                        f"nodes.{node.id}.inputs.{input_name}",
                        f"Missing required input: {input_name}",
                    )
                )
    return issues
