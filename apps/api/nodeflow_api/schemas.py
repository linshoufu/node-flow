from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class Position(BaseModel):
    x: float
    y: float


class WorkflowNode(BaseModel):
    id: str
    type: str
    position: Position
    config: dict[str, Any] = Field(default_factory=dict)
    subflows: dict[str, "WorkflowSubflow"] = Field(default_factory=dict)


class WorkflowEdge(BaseModel):
    id: str
    source: str
    sourceHandle: str
    target: str
    targetHandle: str


class WorkflowSubflow(BaseModel):
    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)


class WorkflowDocument(BaseModel):
    id: str
    name: str
    version: int = 1
    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)


class WorkflowSummary(BaseModel):
    id: str
    name: str
    version: int


class ValidationIssue(BaseModel):
    path: str
    message: str


class ValidationResult(BaseModel):
    valid: bool
    issues: list[ValidationIssue] = Field(default_factory=list)


RunStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]


class RunRecord(BaseModel):
    id: str
    workflow_id: str
    workflow_version: int
    status: RunStatus
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    error: str | None = None


class RunEvent(BaseModel):
    id: int | None = None
    run_id: str
    type: str
    timestamp: str
    node_id: str | None = None
    scope: list[str] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)
