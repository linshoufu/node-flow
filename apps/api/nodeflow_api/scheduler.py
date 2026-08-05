from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from .executor import WorkflowExecutor
from .node_registry import NodeRegistry
from .schemas import RunInvocation, RunRecord, WorkflowDocument, WorkflowNode, WorkflowTriggerStatus
from .storage import Storage
from .run_dispatcher import WorkflowRunDispatcher
from .validation import validate_workflow


@dataclass(frozen=True)
class ScheduleBinding:
    workflow: WorkflowDocument
    node: WorkflowNode
    interval_seconds: float

    @property
    def key(self) -> tuple[str, int, str]:
        return (self.workflow.id, self.workflow.version, self.node.id)


class WorkflowScheduler:
    """Launch active interval-triggered workflows without blocking the API server."""

    def __init__(
        self,
        *,
        storage: Storage,
        executor: WorkflowExecutor,
        registry: NodeRegistry,
        dispatcher: WorkflowRunDispatcher | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.storage = storage
        self.executor = executor
        self.registry = registry
        self.dispatcher = dispatcher or WorkflowRunDispatcher(storage=storage, executor=executor)
        self.clock = clock
        self._next_due_at: dict[tuple[str, int, str], float] = {}

    async def tick(self) -> list[RunRecord]:
        now = self.clock()
        bindings = self._bindings()
        binding_keys = {binding.key for binding in bindings}
        self._next_due_at = {
            key: due_at for key, due_at in self._next_due_at.items() if key in binding_keys
        }

        launched: list[RunRecord] = []
        for binding in bindings:
            due_at = self._next_due_at_for(binding)
            if due_at is None:
                self._set_next_due_at(binding, now + binding.interval_seconds)
                continue
            if now < due_at:
                continue

            # Missed intervals are intentionally coalesced into the next future interval.
            self._set_next_due_at(binding, now + binding.interval_seconds)
            invocation = self._invocation(binding, now)
            run = self.storage.create_run(binding.workflow, invocation=invocation)
            self._launch(run, binding, invocation)
            launched.append(run)
        return launched

    async def serve(self, *, poll_interval_seconds: float = 1.0) -> None:
        while True:
            await self.tick()
            await asyncio.sleep(poll_interval_seconds)

    async def stop(self) -> None:
        await self.dispatcher.stop()

    async def wait_for_idle(self) -> None:
        await self.dispatcher.wait_for_idle()

    def trigger_statuses(self, workflow: WorkflowDocument) -> list[WorkflowTriggerStatus]:
        statuses: list[WorkflowTriggerStatus] = []
        for node in workflow.nodes:
            if not self.registry.has(node.type) or self.registry.get(node.type).group != "trigger":
                continue
            trigger_active = workflow.active and not node.disabled
            if node.type == "schedule.trigger":
                binding = ScheduleBinding(
                    workflow=workflow,
                    node=node,
                    interval_seconds=float(node.config.get("interval_seconds", 300)),
                )
                due_at = self._next_due_at_for(binding) if trigger_active else None
                statuses.append(
                    WorkflowTriggerStatus(
                        node_id=node.id,
                        type=node.type,
                        active=trigger_active,
                        interval_seconds=binding.interval_seconds,
                        next_run_at=_timestamp_from_epoch(due_at) if due_at is not None else None,
                    )
                )
                continue
            if node.type == "webhook.trigger":
                statuses.append(
                    WorkflowTriggerStatus(
                        node_id=node.id,
                        type=node.type,
                        active=trigger_active,
                        details={
                            "method": str(node.config.get("method", "POST")).upper(),
                            "path": str(node.config.get("path", "")).strip("/"),
                        },
                    )
                )
                continue
            statuses.append(
                    WorkflowTriggerStatus(
                        node_id=node.id,
                        type=node.type,
                        active=trigger_active,
                )
            )
        return statuses

    def _bindings(self) -> list[ScheduleBinding]:
        bindings: list[ScheduleBinding] = []
        for workflow in self.storage.list_active_workflows():
            if not validate_workflow(workflow, self.registry).valid:
                continue
            for node in workflow.nodes:
                if node.type != "schedule.trigger" or node.disabled:
                    continue
                interval_seconds = float(node.config.get("interval_seconds", 300))
                bindings.append(
                    ScheduleBinding(
                        workflow=workflow,
                        node=node,
                        interval_seconds=interval_seconds,
                    )
                )
        return bindings

    def _invocation(self, binding: ScheduleBinding, now: float) -> RunInvocation:
        scheduled_at = datetime.fromtimestamp(now, timezone.utc).isoformat()
        return RunInvocation(
            entry_node_id=binding.node.id,
            initial_input={"trigger": "schedule", "scheduled_at": scheduled_at},
            execution_mode="schedule",
            environment_id=binding.workflow.settings.environment_id,
        )

    def _launch(
        self,
        run: RunRecord,
        binding: ScheduleBinding,
        invocation: RunInvocation,
    ) -> None:
        self.dispatcher.submit(run, binding.workflow, invocation)

    def _next_due_at_for(self, binding: ScheduleBinding) -> float | None:
        cached = self._next_due_at.get(binding.key)
        if cached is not None:
            return cached
        persisted = self.storage.get_schedule_next_due(*binding.key)
        if persisted is not None:
            self._next_due_at[binding.key] = persisted
        return persisted

    def _set_next_due_at(self, binding: ScheduleBinding, due_at: float) -> None:
        self._next_due_at[binding.key] = due_at
        self.storage.set_schedule_next_due(*binding.key, next_due_at=due_at)


def _timestamp_from_epoch(value: float) -> str:
    return datetime.fromtimestamp(value, timezone.utc).isoformat()
