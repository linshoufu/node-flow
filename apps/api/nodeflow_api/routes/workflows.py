"""工作流文档路由：CRUD、版本、发布、触发器、节点升级。"""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse

from ..node_registry import NodeRegistry
from ..schemas import (
    NodeConfigChange,
    NodeUpgradeSummary,
    WorkflowActivationUpdate,
    WorkflowDocument,
    WorkflowPublicationStatus,
    WorkflowTriggerStatus,
    WorkflowUpgradePreview,
    WebhookTestListenerRequest,
    WebhookTestListenerStatus,
)
from ..storage import Storage, WorkflowVersionConflictError
from ..scheduler import WorkflowScheduler
from ..workflow_node_migrations import WorkflowNodeMigrationError, preview_workflow_node_upgrades
from ..webhook_test_listeners import WebhookTestListenerRegistry
from .common import (
    raise_on_webhook_conflict,
    require_workflow,
    workflow_version_conflict,
)


def build_workflow_router(
    storage: Storage,
    registry: NodeRegistry,
    scheduler: WorkflowScheduler,
    webhook_test_listeners: WebhookTestListenerRegistry,
    validate_workflow_document,
) -> APIRouter:
    router = APIRouter()

    def _require_workflow(workflow_id: str) -> WorkflowDocument:
        return require_workflow(storage, workflow_id)

    def _preview_workflow_upgrades(workflow: WorkflowDocument) -> WorkflowUpgradePreview:
        try:
            preview = preview_workflow_node_upgrades(workflow, registry)
        except WorkflowNodeMigrationError as exc:
            raise HTTPException(
                status_code=422,
                detail=[
                    {
                        "path": exc.path,
                        "message": exc.message,
                        "code": "node_migration_unavailable",
                    }
                ],
            ) from exc
        return WorkflowUpgradePreview(
            workflow=preview.workflow,
            upgrades=[
                NodeUpgradeSummary(
                    nodeId=upgrade.node_id,
                    path=upgrade.path,
                    nodeType=upgrade.node_type,
                    fromVersion=upgrade.from_version,
                    toVersion=upgrade.to_version,
                    configChanges=[
                        NodeConfigChange(
                            path=change.path,
                            kind=change.kind,
                            before=change.before,
                            after=change.after,
                        )
                        for change in upgrade.config_changes
                    ],
                    migrationNotes=upgrade.migration_notes,
                )
                for upgrade in preview.upgrades
            ],
        )

    def _require_webhook_test_trigger(workflow: WorkflowDocument, node_id: str) -> None:
        node = next((candidate for candidate in workflow.nodes if candidate.id == node_id), None)
        if node is None or node.type != "webhook.trigger" or node.disabled:
            raise HTTPException(status_code=422, detail="Webhook test listener requires an enabled Webhook trigger")

    @router.get("/api/workflows")
    def list_workflows():
        return storage.list_workflows()

    @router.post("/api/workflows")
    def save_workflow(
        workflow: WorkflowDocument,
        draft: bool = False,
        expected_version: int | None = Header(
            default=None,
            alias="X-Workflow-Expected-Version",
        ),
    ):
        if storage.get_project_environment(workflow.settings.environment_id) is None:
            raise HTTPException(
                status_code=422,
                detail=[
                    {
                        "path": "settings.environment_id",
                        "message": "所选运行环境不存在。",
                        "code": "environment_not_found",
                    }
                ],
            )
        result = validate_workflow_document(workflow)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in result.issues],
            )
        if not draft and workflow.active:
            raise_on_webhook_conflict(storage, workflow)
        try:
            return storage.save_workflow(
                workflow,
                publish=False if draft else None,
                expected_version=expected_version,
            )
        except WorkflowVersionConflictError as exc:
            raise workflow_version_conflict(
                exc,
                message="工作流已被其他操作更新，请重新加载后再保存。",
            ) from exc

    @router.post("/api/workflows/validate")
    def validate(workflow: WorkflowDocument):
        return validate_workflow_document(workflow)

    @router.delete("/api/workflows/{workflow_id}", status_code=204)
    def delete_workflow(workflow_id: str) -> None:
        outcome, references = storage.delete_workflow(workflow_id)
        if outcome == "not_found":
            raise HTTPException(status_code=404, detail="工作流不存在。")
        if outcome == "referenced":
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "工作流仍被其他工作流调用，无法删除。",
                    "code": "workflow_in_use",
                    "references": [reference.model_dump() for reference in references],
                },
            )
        if outcome == "open_runs":
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "工作流仍有排队或运行中的任务，无法删除。",
                    "code": "workflow_has_open_runs",
                },
            )
        webhook_test_listeners.disarm_workflow(workflow_id)

    @router.get("/api/workflows/{workflow_id}")
    def get_workflow(workflow_id: str):
        return _require_workflow(workflow_id)

    @router.get(
        "/api/workflows/{workflow_id}/publication",
        response_model=WorkflowPublicationStatus,
    )
    def get_workflow_publication(workflow_id: str) -> WorkflowPublicationStatus:
        status = storage.get_workflow_publication_status(workflow_id)
        if status is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return status

    @router.get("/api/workflows/{workflow_id}/versions")
    def list_workflow_versions(workflow_id: str):
        _require_workflow(workflow_id)
        return storage.list_workflow_versions(workflow_id)

    @router.get("/api/workflows/{workflow_id}/versions/{version}")
    def get_workflow_version(workflow_id: str, version: int) -> WorkflowDocument:
        workflow = storage.get_workflow(workflow_id, version)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow version not found")
        return workflow

    @router.post("/api/workflows/{workflow_id}/versions/{version}/restore")
    def restore_workflow_version(
        workflow_id: str,
        version: int,
        expected_version: int | None = Header(
            default=None,
            alias="X-Workflow-Expected-Version",
        ),
    ) -> WorkflowDocument:
        restored = storage.get_workflow(workflow_id, version)
        if restored is None:
            raise HTTPException(status_code=404, detail="Workflow version not found")
        if storage.get_project_environment(restored.settings.environment_id) is None:
            raise HTTPException(status_code=422, detail="所选运行环境不存在")
        result = validate_workflow_document(restored)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in result.issues],
            )
        try:
            return storage.save_workflow(
                restored,
                publish=False,
                action="restore",
                source_version=version,
                expected_version=expected_version,
            )
        except WorkflowVersionConflictError as exc:
            raise workflow_version_conflict(exc) from exc

    @router.post("/api/workflows/{workflow_id}/versions/{version}/rollback")
    def rollback_workflow_version(
        workflow_id: str,
        version: int,
        expected_version: int | None = Header(
            default=None,
            alias="X-Workflow-Expected-Version",
        ),
    ) -> WorkflowDocument:
        publication = storage.get_workflow_publication_status(workflow_id)
        if publication is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        if not publication.active:
            raise HTTPException(status_code=409, detail="工作流尚未发布，无法回滚生产版本。")

        source = storage.get_workflow(workflow_id, version)
        if source is None:
            raise HTTPException(status_code=404, detail="Workflow version not found")
        if storage.get_project_environment(source.settings.environment_id) is None:
            raise HTTPException(status_code=422, detail="所选运行环境不存在")
        result = validate_workflow_document(source)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in result.issues],
            )
        raise_on_webhook_conflict(storage, source.model_copy(update={"active": True}))
        try:
            rolled_back = storage.rollback_workflow_version(
                workflow_id,
                version,
                expected_version=expected_version,
            )
        except WorkflowVersionConflictError as exc:
            raise workflow_version_conflict(exc) from exc
        if rolled_back is None:
            raise HTTPException(status_code=409, detail="无法回滚生产版本。")
        return rolled_back

    @router.post("/api/workflows/{workflow_id}/activation")
    def update_workflow_activation(
        workflow_id: str,
        update: WorkflowActivationUpdate,
        expected_version: int | None = Header(
            default=None,
            alias="X-Workflow-Expected-Version",
        ),
    ) -> WorkflowDocument:
        workflow = _require_workflow(workflow_id)
        if not update.active:
            try:
                unpublished = storage.unpublish_workflow(
                    workflow_id,
                    expected_version=expected_version,
                )
            except WorkflowVersionConflictError as exc:
                raise workflow_version_conflict(exc) from exc
            if unpublished is None:
                raise HTTPException(status_code=404, detail="Workflow not found")
            return unpublished

        publish_candidate = workflow.model_copy(update={"active": True})
        if storage.get_project_environment(publish_candidate.settings.environment_id) is None:
            raise HTTPException(status_code=422, detail="所选运行环境不存在")
        result = validate_workflow_document(publish_candidate)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in result.issues],
            )
        raise_on_webhook_conflict(storage, publish_candidate)
        try:
            published = storage.publish_workflow(
                workflow_id,
                expected_version=expected_version,
            )
        except WorkflowVersionConflictError as exc:
            raise workflow_version_conflict(exc) from exc
        if published is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return published

    @router.post("/api/workflows/{workflow_id}/webhook-test/listen", response_model=WebhookTestListenerStatus)
    def start_webhook_test_listener(
        workflow_id: str,
        request: WebhookTestListenerRequest,
    ) -> WebhookTestListenerStatus:
        workflow = _require_workflow(workflow_id)
        _require_webhook_test_trigger(workflow, request.node_id)
        listener = webhook_test_listeners.arm(workflow_id, request.node_id)
        return WebhookTestListenerStatus(
            workflow_id=listener.workflow_id,
            node_id=listener.node_id,
            active=True,
            expires_at=listener.expires_at.isoformat(),
        )

    @router.get(
        "/api/workflows/{workflow_id}/webhook-test/listen/{node_id}",
        response_model=WebhookTestListenerStatus,
    )
    def get_webhook_test_listener(workflow_id: str, node_id: str) -> WebhookTestListenerStatus:
        _require_workflow(workflow_id)
        listener = webhook_test_listeners.status(workflow_id, node_id)
        if listener is None:
            return WebhookTestListenerStatus(
                workflow_id=workflow_id,
                node_id=node_id,
                active=False,
            )
        return WebhookTestListenerStatus(
            workflow_id=listener.workflow_id,
            node_id=listener.node_id,
            active=True,
            expires_at=listener.expires_at.isoformat(),
        )

    @router.delete(
        "/api/workflows/{workflow_id}/webhook-test/listen/{node_id}",
        response_model=WebhookTestListenerStatus,
    )
    def stop_webhook_test_listener(workflow_id: str, node_id: str) -> WebhookTestListenerStatus:
        _require_workflow(workflow_id)
        webhook_test_listeners.disarm(workflow_id, node_id)
        return WebhookTestListenerStatus(
            workflow_id=workflow_id,
            node_id=node_id,
            active=False,
        )

    @router.get("/api/workflows/{workflow_id}/triggers")
    def list_workflow_triggers(workflow_id: str) -> list[WorkflowTriggerStatus]:
        workflow = _require_workflow(workflow_id)
        published_workflow = storage.get_published_workflow(workflow_id)
        return scheduler.trigger_statuses(
            published_workflow or workflow.model_copy(update={"active": False})
        )

    @router.post("/api/workflows/{workflow_id}/upgrades/preview")
    def preview_workflow_upgrades_route(workflow_id: str) -> JSONResponse:
        workflow = _require_workflow(workflow_id)
        preview = _preview_workflow_upgrades(workflow)
        payload = preview.model_dump(mode="json")
        payload["workflow"] = preview.workflow.model_dump(mode="json", exclude_none=True)
        return JSONResponse(content=payload)

    @router.post("/api/workflows/{workflow_id}/upgrades/apply")
    def apply_workflow_upgrades(
        workflow_id: str,
        expected_version: int | None = Header(
            default=None,
            alias="X-Workflow-Expected-Version",
        ),
    ) -> WorkflowDocument:
        workflow = _require_workflow(workflow_id)
        if expected_version is not None and workflow.version != expected_version:
            raise workflow_version_conflict(
                WorkflowVersionConflictError(
                    workflow_id=workflow_id,
                    expected_version=expected_version,
                    current_version=workflow.version,
                )
            )
        preview = _preview_workflow_upgrades(workflow)
        if not preview.upgrades:
            return workflow
        result = validate_workflow_document(preview.workflow)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in result.issues],
            )
        try:
            return storage.save_workflow(
                preview.workflow,
                publish=False,
                expected_version=expected_version,
            )
        except WorkflowVersionConflictError as exc:
            raise workflow_version_conflict(exc) from exc

    return router
