"""运行管理路由：创建、查询、取消、重试。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..node_registry import NodeRegistry
from ..run_dispatcher import WorkflowRunDispatcher
from ..schemas import (
    ManualRunRequest,
    RunEvent,
    RunInvocation,
    RunQueueStatus,
    RunStatus,
)
from ..storage import Storage, utc_now
from ..validation import manual_run_entry_issues


def build_run_router(
    storage: Storage,
    dispatcher: WorkflowRunDispatcher,
    registry: NodeRegistry,
    validate_workflow_document,
) -> APIRouter:
    router = APIRouter()

    @router.get("/api/workflows/{workflow_id}/runs")
    def list_workflow_runs(workflow_id: str, limit: int = 10, offset: int = 0, status: RunStatus | None = None):
        workflow = storage.get_workflow(workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return storage.list_workflow_runs(workflow_id, limit=limit, offset=offset, status=status)

    @router.post("/api/workflows/{workflow_id}/runs")
    async def create_run(workflow_id: str, request: ManualRunRequest | None = None):
        workflow = storage.get_workflow(workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        result = validate_workflow_document(workflow)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in result.issues],
            )
        entry_node_id = request.entry_node_id if request is not None else None
        has_initial_input = request is not None and "initial_input" in request.model_fields_set
        initial_input = request.initial_input if has_initial_input else {}
        environment_id = request.environment_id if request and request.environment_id else workflow.settings.environment_id
        if storage.get_project_environment(environment_id) is None:
            raise HTTPException(status_code=422, detail="所选运行环境不存在")
        entry_issues = manual_run_entry_issues(workflow, registry, entry_node_id)
        if entry_issues:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in entry_issues],
            )
        run = storage.create_run(
            workflow,
            invocation=RunInvocation(
                execution_mode="manual",
                entry_node_id=entry_node_id,
                initial_input=initial_input,
                has_initial_input=has_initial_input,
                environment_id=environment_id,
            ),
        )
        dispatcher.submit(run, workflow)
        return run

    @router.get("/api/runs/{run_id}")
    def get_run(run_id: str):
        run = storage.get_run(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return run

    @router.get("/api/runs/{run_id}/queue", response_model_exclude_none=True)
    def get_run_queue_status(run_id: str) -> RunQueueStatus | None:
        if storage.get_run(run_id) is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return dispatcher.queue_status(run_id)

    @router.get("/api/runs/{run_id}/events")
    def list_run_events(run_id: str):
        if storage.get_run(run_id) is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return storage.list_events(run_id)

    @router.post("/api/runs/{run_id}/cancel")
    def cancel_run(run_id: str):
        if not dispatcher.cancel(run_id):
            raise HTTPException(status_code=404, detail="Run not found")
        run = storage.get_run(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return run

    @router.post("/api/runs/{run_id}/retry")
    async def retry_run(run_id: str):
        source_run = storage.get_run(run_id)
        if source_run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        if source_run.status not in {"failed", "cancelled"}:
            raise HTTPException(
                status_code=409,
                detail="Only completed failed or cancelled runs can be retried",
            )

        source_invocation = storage.get_run_invocation(run_id) or RunInvocation()
        if source_run.parent_run_id or source_invocation.execution_mode not in {"manual", "schedule"}:
            raise HTTPException(
                status_code=409,
                detail="Only manual or scheduled root runs can be retried",
            )

        workflow = storage.get_workflow(source_run.workflow_id, source_run.workflow_version)
        if workflow is None:
            raise HTTPException(status_code=409, detail="The workflow version used by this run is no longer available")
        result = validate_workflow_document(workflow)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in result.issues],
            )
        entry_issues = manual_run_entry_issues(workflow, registry, source_invocation.entry_node_id)
        if entry_issues:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in entry_issues],
            )

        retry_invocation = source_invocation.model_copy(update={"execution_mode": "manual"})
        retry = storage.create_run(workflow, invocation=retry_invocation)
        storage.append_event(
            RunEvent(
                run_id=source_run.id,
                type="run_retry_requested",
                timestamp=utc_now(),
                payload={"retry_run_id": retry.id, "workflow_version": source_run.workflow_version},
            )
        )
        storage.append_event(
            RunEvent(
                run_id=retry.id,
                type="run_retried",
                timestamp=utc_now(),
                payload={"source_run_id": source_run.id, "source_workflow_version": source_run.workflow_version},
            )
        )
        dispatcher.submit(retry, workflow, retry_invocation)
        return retry

    return router
