from __future__ import annotations

from .run_dispatcher import WorkflowRunDispatcher
from .schemas import RunEvent, RunRecord
from .storage import Storage, utc_now


class RunRecoveryService:
    """Reconcile runs left open by a previous API process before accepting new work."""

    _RESUMABLE_MODES = frozenset({"manual", "schedule"})

    def __init__(
        self,
        *,
        storage: Storage,
        dispatcher: WorkflowRunDispatcher,
        mark_interrupted_running: bool = True,
        resume_queued_runs: bool = True,
    ) -> None:
        self.storage = storage
        self.dispatcher = dispatcher
        self.mark_interrupted_running = mark_interrupted_running
        self.resume_queued_runs = resume_queued_runs

    async def recover(self) -> list[RunRecord]:
        resumed: list[RunRecord] = []
        for run in self.storage.list_runs_requiring_recovery():
            invocation = self.storage.get_run_invocation(run.id)
            if invocation is None:
                continue
            if run.status == "running" and self.mark_interrupted_running:
                self._fail(
                    run,
                    "run_interrupted",
                    "Run was interrupted by a service restart and was not replayed.",
                )
                continue
            if run.status == "queued" and not self.resume_queued_runs:
                continue
            if self.storage.is_run_cancel_requested(run.id):
                self._cancel_queued_run(run)
                continue
            if invocation.execution_mode not in self._RESUMABLE_MODES:
                self._fail(
                    run,
                    "run_recovery_skipped",
                    f"Queued {invocation.execution_mode} run was not replayed after service restart.",
                )
                continue
            workflow = self.storage.get_workflow(run.workflow_id, run.workflow_version)
            if workflow is None:
                self._fail(
                    run,
                    "run_recovery_skipped",
                    "Workflow version for queued run is no longer available.",
                )
                continue

            self._event(
                run.id,
                "run_recovered",
                {"execution_mode": invocation.execution_mode},
            )
            self.dispatcher.submit(run, workflow, invocation)
            resumed.append(run)
        return resumed

    async def stop(self) -> None:
        await self.dispatcher.stop()

    async def wait_for_idle(self) -> None:
        await self.dispatcher.wait_for_idle()

    def _fail(self, run: RunRecord, event_type: str, reason: str) -> None:
        self._event(run.id, event_type, {"reason": reason})
        self.storage.update_run(run.id, status="failed", error=reason)

    def _cancel_queued_run(self, run: RunRecord) -> None:
        self._event(run.id, "run_cancelled", {"reason": "Cancellation requested before recovery."})
        self.storage.update_run(run.id, status="cancelled")

    def _event(self, run_id: str, event_type: str, payload: dict[str, str]) -> None:
        self.storage.append_event(
            RunEvent(
                run_id=run_id,
                type=event_type,
                timestamp=utc_now(),
                payload=payload,
            )
        )
