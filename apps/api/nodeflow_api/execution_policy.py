from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from .node_registry import NodeRegistry
    from .schemas import WorkflowEdge, WorkflowNode


class PolicyModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class RetryPolicy(PolicyModel):
    max_attempts: int = Field(default=1, alias="maxAttempts", ge=1, le=5)
    delay_seconds: float = Field(default=0, alias="delaySeconds", ge=0, le=60)


class NodeExecutionPolicy(PolicyModel):
    on_error: Literal["stop", "continue", "errorOutput"] = Field(default="stop", alias="onError")
    retry: RetryPolicy = Field(default_factory=RetryPolicy)


class NodeExecutionError(PolicyModel):
    message: str
    error_type: str = Field(alias="type")
    attempt: int
    node_id: str = Field(alias="nodeId")
    scope: list[str]
    timestamp: str


DEFAULT_NODE_EXECUTION_POLICY = NodeExecutionPolicy().model_dump(by_alias=True)


def normalize_node_execution_policy(value: NodeExecutionPolicy | None) -> NodeExecutionPolicy:
    return value or NodeExecutionPolicy()


def node_execution_error(
    exc: Exception,
    *,
    attempt: int,
    node_id: str,
    scope: list[str],
    timestamp: str,
) -> NodeExecutionError:
    return NodeExecutionError(
        message=str(exc),
        type=type(exc).__name__,
        attempt=attempt,
        nodeId=node_id,
        scope=scope,
        timestamp=timestamp,
    )


def execution_policy_issues(
    node: WorkflowNode,
    edges: list[WorkflowEdge],
    registry: NodeRegistry,
    path: str,
) -> list[tuple[str, str]]:
    policy = normalize_node_execution_policy(node.execution)
    if policy.on_error != "errorOutput" or not registry.has(node.type):
        return []

    node_type = registry.get(node.type)
    has_error_port = "error" in node_type.outputs
    has_error_edge = any(edge.source == node.id and edge.sourceHandle == "error" for edge in edges)
    if has_error_port and has_error_edge:
        return []
    return [
        (
            f"{path}.execution.onError",
            "错误端口策略要求节点声明并连接 error 输出端口",
        )
    ]
