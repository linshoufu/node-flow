"""运行管理路由：创建、查询、取消、重试与事件流。"""

from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, HTTPException, Query
from starlette.responses import StreamingResponse

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

# 运行终态：到达后不会再产生新事件（与 schemas.RunStatus 定义保持一致）
TERMINAL_RUN_STATUSES = {"succeeded", "failed", "cancelled"}
# SSE 游标 tail 的轮询间隔（秒）
SSE_POLL_INTERVAL_SECONDS = 0.25
# SSE 空闲心跳间隔（秒），防止代理或客户端断开空闲连接
SSE_HEARTBEAT_INTERVAL_SECONDS = 15.0


def _sse_event_frame(event: RunEvent) -> str:
    """构造单条 SSE 事件帧：id 为事件自增 id，data 为事件完整 JSON。"""
    return f"id: {event.id}\ndata: {event.model_dump_json()}\n\n"


def build_run_router(
    storage: Storage,
    dispatcher: WorkflowRunDispatcher,
    registry: NodeRegistry,
    validate_workflow_document,
) -> APIRouter:
    router = APIRouter()

    async def _stream_run_events(run_id: str):
        """SSE 事件流：先回放已有事件，再基于 after_id 游标 tail SQLite 增量推送。

        直接查询 run_events 表，同时兼容 embedded 与独立 worker 两种执行模式。
        """
        last_id = 0
        last_send_at = time.monotonic()
        try:
            while True:
                # 拉取游标之后的新增事件并逐条推送
                for event in storage.list_events(run_id, after_id=last_id):
                    yield _sse_event_frame(event)
                    if event.id is not None:
                        last_id = event.id
                    last_send_at = time.monotonic()
                run = storage.get_run(run_id)
                if run is None or run.status in TERMINAL_RUN_STATUSES:
                    # 到达终态（或 run 被删除）：再拉一次保证尾部事件不丢失，然后关闭流
                    for event in storage.list_events(run_id, after_id=last_id):
                        yield _sse_event_frame(event)
                    return
                if time.monotonic() - last_send_at >= SSE_HEARTBEAT_INTERVAL_SECONDS:
                    # 注释行心跳，客户端会忽略但可保活连接
                    yield ": keep-alive\n\n"
                    last_send_at = time.monotonic()
                await asyncio.sleep(SSE_POLL_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            # 客户端断开时任务被取消，干净退出
            return

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
    def list_run_events(
        run_id: str,
        after_id: int | None = Query(default=None, ge=0, description="仅返回 id 大于该值的事件"),
        limit: int | None = Query(default=None, ge=1, description="返回条数上限"),
    ):
        if storage.get_run(run_id) is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return storage.list_events(run_id, after_id=after_id, limit=limit)

    @router.get("/api/runs/{run_id}/events/stream")
    async def stream_run_events(run_id: str):
        """SSE 实时事件流：回放已有事件后持续推送增量，运行到达终态后自动关闭。"""
        if storage.get_run(run_id) is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return StreamingResponse(
            _stream_run_events(run_id),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

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
