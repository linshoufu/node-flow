from __future__ import annotations

from .schemas import WorkflowEdge, WorkflowNode


def webhook_trigger_issues(
    nodes: list[WorkflowNode], edges: list[WorkflowEdge]
) -> list[tuple[str, str]]:
    incoming_edges_by_node: dict[str, list[WorkflowEdge]] = {}
    for edge in edges:
        incoming_edges_by_node.setdefault(edge.target, []).append(edge)

    issues: list[tuple[str, str]] = []
    node_by_id = {node.id: node for node in nodes}
    root_node_ids = {node.id for node in nodes if node.id not in incoming_edges_by_node}
    bindings: dict[tuple[str, str], str] = {}
    for node in nodes:
        if node.type != "webhook.trigger":
            continue

        for edge in incoming_edges_by_node.get(node.id, []):
            issues.append(
                (
                    f"edges.{edge.id}.target",
                    "Webhook trigger must not have incoming connections.",
                )
            )

        if node.disabled:
            continue

        method = str(node.config.get("method", "POST")).upper()
        path = _normalize_webhook_path(str(node.config.get("path", "")))
        if not path:
            continue

        binding = (method, path)
        previous_node_id = bindings.get(binding)
        if previous_node_id is not None:
            issues.append(
                (
                    f"nodes.{node.id}.config.path",
                    f"Webhook endpoint {method} /{path} is already used by node {previous_node_id}.",
                )
            )
            continue

        bindings[binding] = node.id

    for node in nodes:
        if node.type != "webhook.respond":
            continue
        root_ids = _ancestor_root_node_ids(node.id, incoming_edges_by_node, root_node_ids)
        if not root_ids or any(node_by_id[root_id].type != "webhook.trigger" for root_id in root_ids):
            issues.append(
                (
                    f"nodes.{node.id}",
                    "Webhook response nodes require a Webhook trigger on every incoming workflow path.",
                )
            )
        elif any(
            node_by_id[root_id].config.get("response_mode", "sync") == "immediate"
            for root_id in root_ids
        ):
            issues.append(
                (
                    f"nodes.{node.id}",
                    "立即确认的 Webhook 不能使用 Webhook 响应节点。",
                )
            )

    return issues


def _normalize_webhook_path(path: str) -> str:
    return path.strip().strip("/")


def _ancestor_root_node_ids(
    node_id: str,
    incoming_edges_by_node: dict[str, list[WorkflowEdge]],
    root_node_ids: set[str],
) -> set[str]:
    root_ids: set[str] = set()
    pending = [node_id]
    visited: set[str] = set()
    while pending:
        current_id = pending.pop()
        if current_id in visited:
            continue
        visited.add(current_id)
        if current_id in root_node_ids:
            root_ids.add(current_id)
            continue
        pending.extend(edge.source for edge in incoming_edges_by_node.get(current_id, []))
    return root_ids
