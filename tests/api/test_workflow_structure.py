from apps.api.nodeflow_api.schemas import Position, WorkflowEdge, WorkflowNode
from apps.api.nodeflow_api.workflow_structure import (
    cycle_issues,
    duplicate_edge_id_issues,
    duplicate_node_id_issues,
)


def node(node_id: str) -> WorkflowNode:
    return WorkflowNode(id=node_id, type="utility.log", position=Position(x=0, y=0))


def edge(edge_id: str, source: str, target: str) -> WorkflowEdge:
    return WorkflowEdge(
        id=edge_id,
        source=source,
        sourceHandle="success",
        target=target,
        targetHandle="input",
    )


def test_duplicate_id_issues_report_stable_workflow_paths():
    assert duplicate_node_id_issues([node("a"), node("a")]) == [
        ("nodes", "Node IDs must be unique")
    ]
    assert duplicate_edge_id_issues([edge("e1", "a", "b"), edge("e1", "b", "c")]) == [
        ("edges", "Edge IDs must be unique")
    ]


def test_cycle_issues_detect_normal_graph_cycle():
    issues = cycle_issues(
        [node("a"), node("b")],
        [
            edge("e1", "a", "b"),
            edge("e2", "b", "a"),
        ],
    )

    assert issues == [("edges", "Workflow graph contains a cycle")]


def test_cycle_issues_ignore_edges_attached_to_unknown_nodes():
    issues = cycle_issues(
        [node("a"), node("b")],
        [
            edge("e1", "a", "missing"),
            edge("e2", "missing", "a"),
        ],
    )

    assert issues == []


def test_cycle_issues_accept_long_acyclic_chain_without_recursion():
    nodes = [node(f"node_{index}") for index in range(1200)]
    edges = [
        edge(f"e{index}", f"node_{index}", f"node_{index + 1}")
        for index in range(len(nodes) - 1)
    ]

    assert cycle_issues(nodes, edges) == []
