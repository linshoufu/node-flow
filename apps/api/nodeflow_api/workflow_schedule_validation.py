from __future__ import annotations

from .schemas import WorkflowEdge, WorkflowNode


def schedule_trigger_issues(
    nodes: list[WorkflowNode], edges: list[WorkflowEdge], *, allow_schedule: bool = True
) -> list[tuple[str, str]]:
    issues: list[tuple[str, str]] = []
    incoming_targets = {edge.target for edge in edges}
    for node in nodes:
        if node.type != "schedule.trigger":
            continue
        if not allow_schedule:
            issues.append(
                (
                    f"nodes.{node.id}",
                    "Schedule trigger can only be used in a top-level workflow.",
                )
            )
        elif node.id in incoming_targets:
            issues.append(
                (
                    f"nodes.{node.id}",
                    "Schedule trigger must not have incoming connections.",
                )
            )
    return issues
