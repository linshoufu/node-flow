"""跨路由组共享的 HTTP 辅助函数。"""

from __future__ import annotations

from fastapi import HTTPException

from ..credentials import credential_type_by_id, list_credential_types
from ..storage import Storage, WorkflowVersionConflictError
from ..validation import validate_workflow


def workflow_version_conflict(
    exc: WorkflowVersionConflictError,
    *,
    message: str = "工作流已被其他操作更新，请重新加载后再继续。",
) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "workflow_version_conflict",
            "message": message,
            "expected_version": exc.expected_version,
            "current_version": exc.current_version,
        },
    )


def lookup_credential_type(type_id: str, registry):
    """内置凭据类型优先，其次查找节点包提供的凭据类型。"""
    return credential_type_by_id(type_id) or registry.get_credential_type(type_id)


def list_all_credential_types(registry):
    return (*list_credential_types(), *registry.list_credential_types())


def make_workflow_validator(registry, storage: Storage):
    def validate(workflow):
        return validate_workflow(
            workflow,
            registry,
            credential_lookup=storage.get_credential,
            credential_type_lookup=lambda type_id: lookup_credential_type(type_id, registry),
            error_workflow_lookup=storage.get_workflow,
        )

    return validate


def require_workflow(storage: Storage, workflow_id: str):
    workflow = storage.get_workflow(workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow


def raise_on_webhook_conflict(storage: Storage, workflow) -> None:
    for node in workflow.nodes:
        if node.type != "webhook.trigger" or node.disabled:
            continue
        conflict = storage.find_webhook_binding(
            method=str(node.config.get("method", "POST")),
            path=str(node.config.get("path", "")),
            exclude_workflow_id=workflow.id,
        )
        if conflict is not None:
            conflicting_workflow, _ = conflict
            raise HTTPException(
                status_code=409,
                detail=f"Webhook endpoint is already used by workflow: {conflicting_workflow.name}",
            )
