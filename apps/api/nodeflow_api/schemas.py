from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator
from packaging.version import InvalidVersion, Version

from .execution_policy import NodeExecutionPolicy
from .workflow_variables import is_workflow_variable_name


class Position(BaseModel):
    x: float
    y: float


class NodePackageSettingsUpdate(BaseModel):
    enabled: bool
    locked_version: str | None = None

    @field_validator("locked_version")
    @classmethod
    def validate_locked_version(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        try:
            Version(normalized)
        except InvalidVersion as exc:
            raise ValueError("锁定版本必须是有效的 PEP 440 版本号") from exc
        return normalized


def _normalized_credential_overrides(value: dict[str, str]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for source_id, target_id in value.items():
        source = source_id.strip()
        target = target_id.strip()
        if not source or not target:
            raise ValueError("凭据映射必须包含来源凭据和目标凭据。")
        normalized[source] = target
    return normalized


class CanvasAnnotation(BaseModel):
    id: str
    content: str = Field(default="", max_length=5000)
    position: Position
    width: float = Field(default=320, ge=160, le=1600)
    height: float = Field(default=180, ge=100, le=1200)
    color: Literal["yellow", "blue", "green", "pink"] = "yellow"

    @field_validator("content", mode="before")
    @classmethod
    def normalize_content(cls, value: Any) -> str:
        return value.strip() if isinstance(value, str) else ""


class WorkflowNode(BaseModel):
    id: str
    type: str
    disabled: bool = False
    label: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=2000)
    typeVersion: int = Field(default=1, ge=1)
    position: Position
    config: dict[str, Any] = Field(default_factory=dict)
    pinnedData: dict[str, Any] | None = None
    execution: NodeExecutionPolicy | None = None
    subflows: dict[str, "WorkflowSubflow"] = Field(default_factory=dict)

    @field_validator("label", mode="before")
    @classmethod
    def normalize_label(cls, value: Any) -> str:
        return value.strip() if isinstance(value, str) else ""

    @field_validator("notes", mode="before")
    @classmethod
    def normalize_notes(cls, value: Any) -> str:
        return value.strip() if isinstance(value, str) else ""


class WorkflowEdge(BaseModel):
    id: str
    source: str
    sourceHandle: str
    target: str
    targetHandle: str


class WorkflowSubflow(BaseModel):
    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)
    annotations: list[CanvasAnnotation] = Field(default_factory=list)


class WorkflowSettings(BaseModel):
    timeout_seconds: float = Field(default=600, gt=0)
    variables: dict[str, Any] = Field(default_factory=dict)
    error_workflow_id: str | None = Field(default=None, min_length=1, max_length=120)
    max_concurrent_runs: int | None = None
    environment_id: str = Field(default="default", min_length=1, max_length=120)

    @field_validator("environment_id")
    @classmethod
    def normalize_environment_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("运行环境不能为空")
        return normalized

class WorkflowDocument(BaseModel):
    id: str
    name: str
    active: bool = True
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    version: int = 1
    settings: WorkflowSettings = Field(default_factory=WorkflowSettings)
    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)
    annotations: list[CanvasAnnotation] = Field(default_factory=list)

    @field_validator("description", mode="before")
    @classmethod
    def normalize_description(cls, value: Any) -> str:
        return value.strip() if isinstance(value, str) else ""

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []

        tags: list[str] = []
        seen: set[str] = set()
        for raw_tag in value:
            if not isinstance(raw_tag, str):
                continue
            tag = raw_tag.strip()
            if not tag or tag.casefold() in seen:
                continue
            seen.add(tag.casefold())
            tags.append(tag)
        return tags


class WorkflowSummary(BaseModel):
    id: str
    name: str
    active: bool = True
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    version: int
    updated_at: str
    node_count: int = 0
    last_run_status: RunStatus | None = None


class WorkflowVersionSummary(BaseModel):
    version: int
    created_at: str
    name: str
    active: bool
    node_count: int = 0
    action: Literal["save", "restore", "rollback"] = "save"
    source_version: int | None = None


class CredentialRecord(BaseModel):
    id: str
    type_id: str
    name: str
    encrypted_data: str
    created_at: str
    updated_at: str


class CredentialSummary(BaseModel):
    id: str
    type_id: str
    name: str
    created_at: str
    updated_at: str


class CredentialCreateRequest(BaseModel):
    type_id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=120)
    data: dict[str, str] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("凭据名称不能为空")
        return normalized


class CredentialUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    data: dict[str, str] | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("凭据名称不能为空")
        return normalized


class CredentialReference(BaseModel):
    workflow_id: str
    workflow_name: str
    node_id: str
    node_label: str


class ProjectVariable(BaseModel):
    name: str
    value: Any
    created_at: str
    updated_at: str


class ProjectVariableCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    value: Any

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not is_workflow_variable_name(value):
            raise ValueError("变量名只能包含字母、数字和下划线，且不能以数字开头。")
        return value


class ProjectVariableUpdateRequest(BaseModel):
    value: Any


class ProjectEnvironment(BaseModel):
    id: str
    name: str
    variables: dict[str, Any] = Field(default_factory=dict)
    credential_overrides: dict[str, str] = Field(default_factory=dict)
    is_default: bool = False
    created_at: str
    updated_at: str


class ProjectEnvironmentCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    variables: dict[str, Any] = Field(default_factory=dict)
    credential_overrides: dict[str, str] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("环境名称不能为空")
        return normalized

    @field_validator("variables")
    @classmethod
    def validate_variable_names(cls, value: dict[str, Any]) -> dict[str, Any]:
        invalid_names = [name for name in value if not is_workflow_variable_name(name)]
        if invalid_names:
            raise ValueError("环境变量名只能包含字母、数字和下划线，且不能以数字开头。")
        return value

    @field_validator("credential_overrides")
    @classmethod
    def validate_credential_overrides(cls, value: dict[str, str]) -> dict[str, str]:
        return _normalized_credential_overrides(value)


class ProjectEnvironmentUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    variables: dict[str, Any] | None = None
    credential_overrides: dict[str, str] | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("环境名称不能为空")
        return normalized

    @field_validator("credential_overrides")
    @classmethod
    def validate_credential_overrides(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        return _normalized_credential_overrides(value) if value is not None else None

    @field_validator("variables")
    @classmethod
    def validate_variable_names(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is None:
            return None
        invalid_names = [name for name in value if not is_workflow_variable_name(name)]
        if invalid_names:
            raise ValueError("环境变量名只能包含字母、数字和下划线，且不能以数字开头。")
        return value


class WorkflowReference(BaseModel):
    workflow_id: str
    workflow_name: str
    node_id: str
    node_label: str


class WorkflowActivationUpdate(BaseModel):
    active: bool


class WorkflowPublicationStatus(BaseModel):
    workflow_id: str
    draft_version: int
    published_version: int | None = None
    active: bool
    has_unpublished_changes: bool


class WorkflowTriggerStatus(BaseModel):
    node_id: str
    type: str
    active: bool
    interval_seconds: float | None = None
    next_run_at: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class WebhookTestListenerRequest(BaseModel):
    node_id: str = Field(min_length=1, max_length=120)


class WebhookTestListenerStatus(BaseModel):
    workflow_id: str
    node_id: str
    active: bool
    expires_at: str | None = None


class ValidationIssue(BaseModel):
    path: str
    message: str
    code: str | None = None
    details: dict[str, Any] | None = None


class ValidationResult(BaseModel):
    valid: bool
    issues: list[ValidationIssue] = Field(default_factory=list)


class NodeUpgradeSummary(BaseModel):
    nodeId: str
    path: str
    nodeType: str
    fromVersion: int
    toVersion: int
    configChanges: list["NodeConfigChange"] = Field(default_factory=list)
    migrationNotes: list[str] = Field(default_factory=list)


class NodeConfigChange(BaseModel):
    path: str
    kind: Literal["added", "changed", "removed"]
    before: Any = None
    after: Any = None


class WorkflowUpgradePreview(BaseModel):
    workflow: WorkflowDocument
    upgrades: list[NodeUpgradeSummary] = Field(default_factory=list)


RunStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
RunExecutionMode = Literal["manual", "schedule", "webhook", "webhook_test", "child", "error"]


class RunInvocation(BaseModel):
    """The durable launch contract needed to safely resume a queued run."""

    entry_node_id: str | None = None
    initial_input: Any = Field(default_factory=dict)
    has_initial_input: bool = False
    execution_mode: RunExecutionMode = "manual"
    allow_pinned_data: bool = True
    project_variables: dict[str, Any] = Field(default_factory=dict)
    environment_id: str = "default"
    environment_name: str = "默认环境"
    credential_overrides: dict[str, str] = Field(default_factory=dict)


class ManualRunRequest(BaseModel):
    """Optional manual-run scope requested by the workflow editor."""

    entry_node_id: str | None = Field(default=None, min_length=1, max_length=120)
    initial_input: Any = None
    environment_id: str | None = Field(default=None, min_length=1, max_length=120)


class RunRecord(BaseModel):
    id: str
    workflow_id: str
    workflow_version: int
    status: RunStatus
    execution_mode: RunExecutionMode = "manual"
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    cancel_requested_at: str | None = None
    parent_run_id: str | None = None
    parent_node_id: str | None = None
    error: str | None = None


class RunQueueStatus(BaseModel):
    run_id: str
    state: Literal["queued", "running"]
    position: int | None = None
    active_count: int = Field(ge=0)
    concurrency_limit: int = Field(ge=1)
    workflow_active_count: int | None = Field(default=None, ge=0)
    workflow_concurrency_limit: int | None = Field(default=None, ge=1)


class RunEvent(BaseModel):
    id: int | None = None
    run_id: str
    type: str
    timestamp: str
    node_id: str | None = None
    scope: list[str] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)
