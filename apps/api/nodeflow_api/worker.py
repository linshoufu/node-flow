from __future__ import annotations

import argparse
import asyncio
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from .executor import ExecutionContext, WorkflowExecutor
from .node_package_installer import NodePackageInstaller
from .node_registry import NodeRegistry
from .schemas import RunEvent, RunInvocation, RunRecord, WorkflowDocument
from .storage import Storage, utc_now


class WorkflowWorker:
    """A separate process role that claims and executes durable root runs."""

    def __init__(
        self,
        *,
        storage: Storage,
        executor: WorkflowExecutor,
        worker_id: str | None = None,
        max_concurrent_runs: int = 4,
        lease_seconds: float = 120.0,
    ) -> None:
        if max_concurrent_runs < 1:
            raise ValueError("max_concurrent_runs must be at least 1")
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        self.storage = storage
        self.executor = executor
        self.worker_id = worker_id or f"worker_{uuid4().hex}"
        self.max_concurrent_runs = max_concurrent_runs
        self.lease_seconds = lease_seconds
        self._tasks: set[asyncio.Task[object]] = set()

    async def tick(self) -> list[RunRecord]:
        claimed: list[RunRecord] = []
        self.executor.refresh_node_registry_if_changed()
        for expired_run in self.storage.fail_expired_worker_runs():
            self._event(
                expired_run.id,
                "run_worker_lost",
                {"reason": "Worker lease expired before the run completed."},
            )
        while len(self._tasks) < self.max_concurrent_runs:
            run = self.storage.claim_next_queued_run(
                self.worker_id,
                lease_seconds=self.lease_seconds,
                concurrency_limit=self.max_concurrent_runs,
            )
            if run is None:
                break
            invocation = self.storage.get_run_invocation(run.id)
            workflow = self.storage.get_workflow(run.workflow_id, run.workflow_version)
            if invocation is None or workflow is None:
                self._fail_unexecutable_run(run, "Queued run could not be loaded by the worker.")
                continue
            self._event(run.id, "run_claimed", {"worker_id": self.worker_id})
            task = asyncio.create_task(self._execute_claimed(run, workflow, invocation))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
            claimed.append(run)
        return claimed

    async def serve(self, *, poll_interval_seconds: float = 0.5) -> None:
        while True:
            await self.tick()
            await asyncio.sleep(poll_interval_seconds)

    async def stop(self) -> None:
        tasks = list(self._tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def wait_for_idle(self) -> None:
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    async def _execute_claimed(
        self,
        run: RunRecord,
        workflow: WorkflowDocument,
        invocation: RunInvocation,
    ) -> Any:
        heartbeat = asyncio.create_task(self._renew_lease_until_complete(run.id))
        completed = False
        try:
            context = ExecutionContext(
                deadline=time.monotonic() + workflow.settings.timeout_seconds,
                initial_input=invocation.initial_input,
                has_initial_input=invocation.has_initial_input,
                allow_pinned_data=invocation.allow_pinned_data,
                project_variables=invocation.project_variables,
                environment_id=invocation.environment_id,
                environment_name=invocation.environment_name,
                credential_overrides=invocation.credential_overrides,
            )
            output = await self.executor.execute(
                run.id,
                workflow,
                execution_context=context,
                entry_node_id=invocation.entry_node_id,
            )
            completed = True
            return output
        finally:
            heartbeat.cancel()
            await asyncio.gather(heartbeat, return_exceptions=True)
            if completed:
                self.storage.release_run_claim(run.id, self.worker_id)

    async def _renew_lease_until_complete(self, run_id: str) -> None:
        while True:
            await asyncio.sleep(max(0.1, self.lease_seconds / 2))
            if not self.storage.renew_run_lease(
                run_id,
                self.worker_id,
                lease_seconds=self.lease_seconds,
            ):
                return

    def _fail_unexecutable_run(self, run: RunRecord, reason: str) -> None:
        self._event(run.id, "run_failed", {"error": reason})
        self.storage.update_run(run.id, status="failed", error=reason)
        self.storage.release_run_claim(run.id, self.worker_id)

    def _event(self, run_id: str, event_type: str, payload: dict[str, str]) -> None:
        self.storage.append_event(
            RunEvent(
                run_id=run_id,
                type=event_type,
                timestamp=utc_now(),
                payload=payload,
            )
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Node Flow execution worker.")
    parser.add_argument("--database", default="node-flow.sqlite3")
    parser.add_argument("--nodes-dir", default="nodes")
    parser.add_argument("--concurrency", type=int, default=4)
    args = parser.parse_args()

    storage = Storage(args.database)
    storage.init_schema()
    registry = NodeRegistry(
        nodes_dir=Path(args.nodes_dir),
        package_policy_provider=storage.node_package_policies,
    )
    node_package_installer = NodePackageInstaller(
        nodes_dir=registry.nodes_dir,
        registry=registry,
        node_type_reference_provider=storage.list_node_type_references,
    )
    node_package_installer.recover_incomplete_transactions()
    worker = WorkflowWorker(
        storage=storage,
        executor=WorkflowExecutor(
            storage=storage,
            registry=registry,
            registry_refresh=node_package_installer.scan_registry_if_changed,
        ),
        max_concurrent_runs=args.concurrency,
    )
    try:
        asyncio.run(worker.serve())
    finally:
        storage.close()


if __name__ == "__main__":
    main()
