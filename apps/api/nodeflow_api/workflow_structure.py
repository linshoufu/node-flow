from __future__ import annotations

from collections import deque

from .schemas import WorkflowEdge, WorkflowNode

StructureIssue = tuple[str, str]


def duplicate_node_id_issues(nodes: list[WorkflowNode]) -> list[StructureIssue]:
    node_by_id = {node.id: node for node in nodes}
    if len(node_by_id) == len(nodes):
        return []
    return [("nodes", "Node IDs must be unique")]


def duplicate_edge_id_issues(edges: list[WorkflowEdge]) -> list[StructureIssue]:
    edge_by_id = {edge.id: edge for edge in edges}
    if len(edge_by_id) == len(edges):
        return []
    return [("edges", "Edge IDs must be unique")]


def cycle_issues(nodes: list[WorkflowNode], edges: list[WorkflowEdge]) -> list[StructureIssue]:
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

    if visited_count == len(graph):
        return []
    return [("edges", "Workflow graph contains a cycle")]
