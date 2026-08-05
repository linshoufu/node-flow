from __future__ import annotations

import asyncio
import time
from typing import Any

from .executor import ExecutionContext, WorkflowExecutor
from .schemas import RunInvocation, RunQueueStatus, RunRecord, WorkflowDocument
from .storage import Storage


class WorkflowRunDispatcher:
    """Own background execution and apply one concurrency limit to root workflow runs."""

    def __init__(
        self,
        *,
        storage: Storage,
        executor: WorkflowExecutor,
        max_concurrent_runs: int = 4,
        auto_execute: bool = True,
    ) -> None:
        if max_concurrent_runs < 1:
            raise ValueError("max_concurrent_runs must be at least 1")
        self.storage = storage
        self.executor = executor
        self.max_concurrent_runs = max_concurrent_runs
        self.auto_execute = auto_execute
        self._semaphore = asyncio.Semaphore(max_concurrent_runs)
        self._tasks: dict[str, asyncio.Task[object]] = {}
        self._queued_run_ids: list[str] = []
        self._active_run_ids: set[str] = set()
        self._active_run_workflow_ids: dict[str, str] = {}

        self._workflow_semaphores: dict[tuple[str, int], asyncio.Semaphore] = {}
    def submit(
        self,
        run: RunRecord,
        workflow: WorkflowDocument,
        invocation: RunInvocation | None = None,
    ) -> None:
        """Queue a root run without blocking its caller."""
        if not self.auto_execute:
            return
        if run.id in self._tasks:
            return
        invocation = invocation or self.storage.get_run_invocation(run.id) or RunInvocation()
        self._queued_run_ids.append(run.id)
        task = asyncio.create_task(self.execute(run, workflow, invocation))
        self._tasks[run.id] = task
        task.add_done_callback(lambda completed: self._tasks.pop(run.id, None))

    async def execute(
        self,
        run: RunRecord,
        workflow: WorkflowDocument,
        invocation: RunInvocation | None = None,
        *,
        is_webhook_request: bool = False,
        execution_context: ExecutionContext | None = None,
    ) -> Any:
        """Execute through the shared concurrency gate and return the workflow result."""
        invocation = invocation or self.storage.get_run_invocation(run.id) or RunInvocation()
        try:
            workflow_semaphore = self._workflow_semaphore(workflow)
            if workflow_semaphore is not None:
                async with workflow_semaphore:
                    return await self._execute_with_global_limit(
                        run,
                        workflow,
                        invocation,
                        is_webhook_request=is_webhook_request,
                        execution_context=execution_context,
                    )
            return await self._execute_with_global_limit(
                run,
                workflow,
                invocation,
                is_webhook_request=is_webhook_request,
                execution_context=execution_context,
            )
        finally:
            self._remove_queued_run(run.id)

    async def _execute_with_global_limit(
        self,
        run: RunRecord,
        workflow: WorkflowDocument,
        invocation: RunInvocation,
        *,
        is_webhook_request: bool,
        execution_context: ExecutionContext | None,
    ) -> Any:
        async with self._semaphore:
            self._remove_queued_run(run.id)
            self._active_run_ids.add(run.id)
            self._active_run_workflow_ids[run.id] = workflow.id
            try:
                context = execution_context or ExecutionContext(
                    deadline=time.monotonic() + workflow.settings.timeout_seconds,
                    initial_input=invocation.initial_input,
                    has_initial_input=invocation.has_initial_input,
                    allow_pinned_data=invocation.allow_pinned_data,
                    is_webhook_request=is_webhook_request,
                    project_variables=invocation.project_variables,
                    environment_id=invocation.environment_id,
                    environment_name=invocation.environment_name,
                    credential_overrides=invocation.credential_overrides,
                )
                return await self.executor.execute(
                    run.id,
                    workflow,
                    execution_context=context,
                    entry_node_id=invocation.entry_node_id,
                )
            finally:
                self._active_run_ids.discard(run.id)
                self._active_run_workflow_ids.pop(run.id, None)

    def _workflow_semaphore(self, workflow: WorkflowDocument) -> asyncio.Semaphore | None:
        concurrency_limit = workflow.settings.max_concurrent_runs
        if concurrency_limit is None:
            return None

        key = (workflow.id, concurrency_limit)
        return self._workflow_semaphores.setdefault(key, asyncio.Semaphore(concurrency_limit))

    def queue_status(self, run_id: str) -> RunQueueStatus | None:
        workflow_active_count, workflow_concurrency_limit = self._workflow_queue_context(run_id)
        if run_id in self._active_run_ids:
            return RunQueueStatus(
                run_id=run_id,
                state="running",
                active_count=len(self._active_run_ids),
                concurrency_limit=self.max_concurrent_runs,
                workflow_active_count=workflow_active_count,
                workflow_concurrency_limit=workflow_concurrency_limit,
            )
        if run_id in self._queued_run_ids:
            return RunQueueStatus(
                run_id=run_id,
                state="queued",
                position=self._queued_run_ids.index(run_id) + 1,
                active_count=len(self._active_run_ids),
                concurrency_limit=self.max_concurrent_runs,
                workflow_active_count=workflow_active_count,
                workflow_concurrency_limit=workflow_concurrency_limit,
            )
        return self.storage.get_persistent_queue_status(
            run_id,
            concurrency_limit=self.max_concurrent_runs,
        )

    def cancel(self, run_id: str) -> bool:
        if not self.storage.request_run_cancel(run_id):
            return False
        run = self.storage.get_run(run_id)
        if run is not None and run.status == "cancelled":
            task = self._tasks.get(run_id)
            if task is not None:
                task.cancel()
            self._remove_queued_run(run_id)
        return True

    def _workflow_queue_context(self, run_id: str) -> tuple[int | None, int | None]:
        run = self.storage.get_run(run_id)
        if run is None:
            return None, None
        workflow = self.storage.get_workflow(run.workflow_id, run.workflow_version)
        if workflow is None or workflow.settings.max_concurrent_runs is None:
            return None, None
        active_count = sum(
            workflow_id == workflow.id for workflow_id in self._active_run_workflow_ids.values()
        )
        return active_count, workflow.settings.max_concurrent_runs


    async def stop(self) -> None:
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def wait_for_idle(self) -> None:
        while self._tasks:
            await asyncio.gather(*list(self._tasks.values()), return_exceptions=True)

    def _remove_queued_run(self, run_id: str) -> None:
        try:
            self._queued_run_ids.remove(run_id)
        except ValueError:
            pass
