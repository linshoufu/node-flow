"""运行仓储：运行记录、持久队列、事件、调度状态与静态数据。"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Mapping
from datetime import datetime, timezone
from uuid import uuid4

from ..schemas import (
    RunEvent,
    RunInvocation,
    RunQueueStatus,
    RunRecord,
    RunStatus,
    WorkflowDocument,
)
from .base import utc_now
from ..run_parameters import resolve_workflow_parameters
from ..resource_profiles import referenced_profiles
from ..config_bindings import configuration_values, resolve_workflow_bindings


class RunRepositoryMixin:
    def _run_record(self, row) -> RunRecord:
        values = dict(row)
        if "run_mode" not in values:
            invocation = self.get_run_invocation(values["id"])
            values["run_mode"] = invocation.run_mode if invocation else "live"
        return RunRecord(**values)

    def list_run_tree(self, run_id: str) -> list[RunRecord]:
        with self._lock:
            rows = self._connection.execute(
                """WITH RECURSIVE tree(id) AS (
                     SELECT id FROM runs WHERE id = ?
                     UNION ALL SELECT r.id FROM runs r JOIN tree ON r.parent_run_id = tree.id
                   ) SELECT r.*, COALESCE(i.run_mode, 'live') AS run_mode FROM runs r JOIN tree ON r.id = tree.id LEFT JOIN run_invocations i ON i.run_id = r.id""", (run_id,),
            ).fetchall()
        return [self._run_record(row) for row in rows]

    def create_run(
        self,
        workflow: WorkflowDocument,
        *,
        parent_run_id: str | None = None,
        parent_node_id: str | None = None,
        invocation: RunInvocation | None = None,
    ) -> RunRecord:
        invocation = invocation or RunInvocation()
        mode = invocation.run_mode if "run_mode" in invocation.model_fields_set else workflow.settings.run_mode
        if parent_run_id is not None:
            parent_invocation = self.get_run_invocation(parent_run_id)
            # Historical/imported lineage may name a parent outside this DB.
            # Every real child run inherits its persisted parent's policy.
            if parent_invocation is not None:
                mode = parent_invocation.run_mode
        invocation = invocation.model_copy(update={"run_mode": mode})
        updates = {}
        if "parameters" not in invocation.model_fields_set:
            updates["parameters"] = resolve_workflow_parameters(workflow, invocation.initial_input)
        if "configuration" not in invocation.model_fields_set:
            updates["configuration"] = configuration_values(workflow)
        invocation = invocation.model_copy(update=updates)
        bound_workflow = resolve_workflow_bindings(workflow, None, configuration=invocation.configuration, parameters=invocation.parameters, runtime=True)
        environment = self.get_project_environment(invocation.environment_id)
        if environment is None:
            raise ValueError(f"Unknown environment: {invocation.environment_id}")
        snapshot_updates: dict[str, object] = {
            "environment_id": environment.id,
        }
        if "project_variables" not in invocation.model_fields_set:
            snapshot_updates["project_variables"] = environment.variables
        if "environment_name" not in invocation.model_fields_set:
            snapshot_updates["environment_name"] = environment.name
        if "credential_overrides" not in invocation.model_fields_set:
            snapshot_updates["credential_overrides"] = environment.credential_overrides
        invocation = invocation.model_copy(update=snapshot_updates)
        if "profiles" not in invocation.model_fields_set:
            references = set(referenced_profiles(bound_workflow.nodes, {
                "project": invocation.project_variables, "vars": workflow.settings.variables,
                "run_parameters": invocation.parameters,
            }))
            invocation = invocation.model_copy(update={
                "profiles": {profile["id"]: profile for profile in self.list_profiles() if profile["id"] in references},
            })
        if parent_run_id is None and parent_node_id is not None:
            raise ValueError("Run lineage requires both parent_run_id and parent_node_id")
        if parent_run_id is not None and parent_node_id is None and invocation.execution_mode != "error":
            raise ValueError("Run lineage requires both parent_run_id and parent_node_id")
        run = RunRecord(
            id=f"run_{uuid4().hex}",
            workflow_id=workflow.id,
            workflow_version=workflow.version,
            status="queued",
            execution_mode=invocation.execution_mode,
            run_mode=invocation.run_mode,
            created_at=utc_now(),
            parent_run_id=parent_run_id,
            parent_node_id=parent_node_id,
        )
        with self._lock:
            with self._connection:
                self._connection.execute(
                    """
                    INSERT INTO runs (
                      id, workflow_id, workflow_version, status, created_at, parent_run_id, parent_node_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run.id,
                        run.workflow_id,
                        run.workflow_version,
                        run.status,
                        run.created_at,
                        run.parent_run_id,
                        run.parent_node_id,
                    ),
                )
                self._connection.execute(
                    """
                    INSERT INTO run_invocations (
                      run_id, entry_node_id, initial_input_json, has_initial_input, execution_mode, allow_pinned_data,
                      project_variables_json, environment_id, environment_name, credential_overrides_json,
                      profiles_json, parameters_json, run_mode, configuration_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run.id,
                        invocation.entry_node_id,
                        json.dumps(invocation.initial_input),
                        int(invocation.has_initial_input),
                        invocation.execution_mode,
                        int(invocation.allow_pinned_data),
                        json.dumps(invocation.project_variables),
                        invocation.environment_id,
                        invocation.environment_name,
                        json.dumps(invocation.credential_overrides),
                        json.dumps(invocation.profiles),
                        json.dumps(invocation.parameters),
                        invocation.run_mode,
                        json.dumps(invocation.configuration),
                    ),
                )
                return run

    def get_run_invocation(self, run_id: str) -> RunInvocation | None:
        with self._lock:
            run_exists = self._connection.execute(
                "SELECT 1 FROM runs WHERE id = ?", (run_id,)
            ).fetchone()
            if run_exists is None:
                return None
            row = self._connection.execute(
                "SELECT * FROM run_invocations WHERE run_id = ?", (run_id,)
            ).fetchone()
        if row is None:
            # Runs created before this table existed are manual invocations by default.
            return RunInvocation()
        return RunInvocation(
            entry_node_id=row["entry_node_id"],
            initial_input=json.loads(row["initial_input_json"]),
            has_initial_input=bool(row["has_initial_input"]),
            execution_mode=row["execution_mode"],
            run_mode=row["run_mode"],
            allow_pinned_data=bool(row["allow_pinned_data"]),
            project_variables=json.loads(row["project_variables_json"] or "{}"),
            environment_id=row["environment_id"],
            environment_name=row["environment_name"],
            credential_overrides=json.loads(row["credential_overrides_json"] or "{}"),
            profiles=json.loads(row["profiles_json"] or "{}"),
            parameters=json.loads(row["parameters_json"] or "{}"),
            configuration=json.loads(row["configuration_json"] or "{}"),
        )

    def list_runs_requiring_recovery(self) -> list[RunRecord]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM runs
                WHERE status IN ('queued', 'running')
                ORDER BY created_at, rowid
                """
            ).fetchall()
        return [self._run_record(row) for row in rows]

    def claim_next_queued_run(
        self,
        worker_id: str,
        *,
        lease_seconds: float,
        concurrency_limit: int | None = None,
    ) -> RunRecord | None:
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        if concurrency_limit is not None and concurrency_limit < 1:
            raise ValueError("concurrency_limit must be at least 1")
        now = datetime.now(timezone.utc)
        claimed_at = now.isoformat()
        lease_expires_at = datetime.fromtimestamp(
            now.timestamp() + lease_seconds, timezone.utc
        ).isoformat()
        with self._lock:
            # Keep selection, per-workflow capacity check, and claim in one write transaction.
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                if concurrency_limit is not None:
                    active_count = self._connection.execute(
                        "SELECT COUNT(*) AS total FROM runs WHERE status = 'running' AND worker_id IS NOT NULL"
                    ).fetchone()["total"]
                    if active_count >= concurrency_limit:
                        self._connection.rollback()
                        return None
                rows = self._connection.execute(
                    """
                    SELECT r.*
                    FROM runs r
                    JOIN run_invocations i ON i.run_id = r.id
                    WHERE r.status = 'queued'
                      AND i.execution_mode IN ('manual', 'schedule')
                    ORDER BY r.created_at, r.rowid
                    """
                ).fetchall()
                row = next(
                    (
                        candidate
                        for candidate in rows
                        if self._queued_run_has_workflow_capacity(candidate)
                    ),
                    None,
                )
                if row is None:
                    self._connection.rollback()
                    return None
                result = self._connection.execute(
                    """
                    UPDATE runs
                    SET status = 'running',
                        started_at = COALESCE(started_at, ?),
                        worker_id = ?,
                        claimed_at = ?,
                        lease_expires_at = ?
                    WHERE id = ? AND status = 'queued'
                    """,
                    (claimed_at, worker_id, claimed_at, lease_expires_at, row["id"]),
                )
                if result.rowcount == 0:
                    self._connection.rollback()
                    return None
                claimed = self._connection.execute(
                    "SELECT * FROM runs WHERE id = ?", (row["id"],)
                ).fetchone()
                self._connection.commit()
            except Exception:
                self._connection.rollback()
                raise
        return self._run_record(claimed) if claimed is not None else None

    def _queued_run_has_workflow_capacity(self, row: sqlite3.Row) -> bool:
        workflow_row = self._connection.execute(
            "SELECT document_json FROM workflow_versions WHERE workflow_id = ? AND version = ?",
            (row["workflow_id"], row["workflow_version"]),
        ).fetchone()
        if workflow_row is None:
            return False
        workflow = WorkflowDocument.model_validate_json(workflow_row["document_json"])
        concurrency_limit = workflow.settings.max_concurrent_runs
        if concurrency_limit is None:
            return True
        active_count = self._connection.execute(
            """
            SELECT COUNT(*) AS total
            FROM runs
            WHERE workflow_id = ? AND status = 'running' AND worker_id IS NOT NULL
            """,
            (row["workflow_id"],),
        ).fetchone()["total"]
        return active_count < concurrency_limit


    def renew_run_lease(self, run_id: str, worker_id: str, *, lease_seconds: float) -> bool:
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        lease_expires_at = datetime.fromtimestamp(
            datetime.now(timezone.utc).timestamp() + lease_seconds, timezone.utc
        ).isoformat()
        with self._lock:
            with self._connection:
                result = self._connection.execute(
                    """
                    UPDATE runs
                    SET lease_expires_at = ?
                    WHERE id = ? AND worker_id = ? AND status = 'running'
                    """,
                    (lease_expires_at, run_id, worker_id),
                )
        return result.rowcount > 0

    def release_run_claim(self, run_id: str, worker_id: str) -> None:
        with self._lock:
            with self._connection:
                self._connection.execute(
                    """
                    UPDATE runs
                    SET worker_id = NULL, claimed_at = NULL, lease_expires_at = NULL
                    WHERE id = ? AND worker_id = ?
                    """,
                    (run_id, worker_id),
                )

    def fail_expired_worker_runs(self) -> list[RunRecord]:
        timestamp = utc_now()
        error = "Worker lease expired before the run completed."
        failed: list[RunRecord] = []
        with self._lock:
            with self._connection:
                rows = self._connection.execute(
                    """
                    SELECT * FROM runs
                    WHERE status = 'running'
                      AND worker_id IS NOT NULL
                      AND lease_expires_at IS NOT NULL
                      AND lease_expires_at <= ?
                    ORDER BY lease_expires_at, id
                    """,
                    (timestamp,),
                ).fetchall()
                for row in rows:
                    result = self._connection.execute(
                        """
                        UPDATE runs
                        SET status = 'failed', completed_at = ?, error = ?, lease_expires_at = NULL
                        WHERE id = ?
                          AND status = 'running'
                          AND lease_expires_at IS NOT NULL
                          AND lease_expires_at <= ?
                        """,
                        (timestamp, error, row["id"], timestamp),
                    )
                    if result.rowcount > 0:
                        failed.append(
                            RunRecord(
                                **{
                                    **dict(row),
                                    "status": "failed",
                                    "completed_at": timestamp,
                                    "lease_expires_at": None,
                                    "error": error,
                                }
                            )
                        )
        return failed

    def get_persistent_queue_status(
        self, run_id: str, *, concurrency_limit: int
    ) -> RunQueueStatus | None:
        if concurrency_limit < 1:
            raise ValueError("concurrency_limit must be at least 1")
        with self._lock:
            row = self._connection.execute(
                """
                SELECT r.*, r.rowid AS rowid, i.execution_mode
                FROM runs r
                JOIN run_invocations i ON i.run_id = r.id
                WHERE r.id = ?
                """,
                (run_id,),
            ).fetchone()
            if row is None or row["execution_mode"] not in {"manual", "schedule"}:
                return None
            active_count = self._connection.execute(
                "SELECT COUNT(*) AS total FROM runs WHERE status = 'running' AND worker_id IS NOT NULL"
            ).fetchone()["total"]
            workflow = self.get_workflow(row["workflow_id"], row["workflow_version"])
            workflow_concurrency_limit = workflow.settings.max_concurrent_runs if workflow is not None else None
            workflow_active_count = None
            if workflow_concurrency_limit is not None:
                workflow_active_count = self._connection.execute(
                    """
                    SELECT COUNT(*) AS total
                    FROM runs
                    WHERE workflow_id = ? AND status = 'running' AND worker_id IS NOT NULL
                    """,
                    (row["workflow_id"],),
                ).fetchone()["total"]
            if row["status"] == "running" and row["worker_id"] is not None:
                return RunQueueStatus(
                    run_id=run_id,
                    state="running",
                    active_count=active_count,
                    concurrency_limit=concurrency_limit,
                    workflow_active_count=workflow_active_count,
                    workflow_concurrency_limit=workflow_concurrency_limit,
                )
            if row["status"] != "queued":
                return None
            position = self._connection.execute(
                """
                SELECT COUNT(*) AS total
                FROM runs r
                JOIN run_invocations i ON i.run_id = r.id
                WHERE r.status = 'queued'
                  AND i.execution_mode IN ('manual', 'schedule')
                  AND (r.created_at < ? OR (r.created_at = ? AND r.rowid <= ?))
                """,
                (row["created_at"], row["created_at"], row["rowid"]),
            ).fetchone()["total"]
        return RunQueueStatus(
            run_id=run_id,
            state="queued",
            position=position,
            active_count=active_count,
            concurrency_limit=concurrency_limit,
            workflow_active_count=workflow_active_count,
            workflow_concurrency_limit=workflow_concurrency_limit,
        )

    def has_open_run_for_workflow(self, workflow_id: str) -> bool:
        with self._lock:
            return (
                self._connection.execute(
                    """
                    SELECT 1 FROM runs
                    WHERE workflow_id = ? AND status IN ('queued', 'running')
                    LIMIT 1
                    """,
                    (workflow_id,),
                ).fetchone()
                is not None
            )

    def get_schedule_next_due(
        self,
        workflow_id: str,
        workflow_version: int,
        node_id: str,
    ) -> float | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT next_due_at FROM schedule_state
                WHERE workflow_id = ? AND workflow_version = ? AND node_id = ?
                """,
                (workflow_id, workflow_version, node_id),
            ).fetchone()
        return float(row["next_due_at"]) if row is not None else None

    def set_schedule_next_due(
        self,
        workflow_id: str,
        workflow_version: int,
        node_id: str,
        next_due_at: float,
    ) -> None:
        with self._lock:
            with self._connection:
                self._connection.execute(
                    """
                    INSERT INTO schedule_state (
                      workflow_id, workflow_version, node_id, next_due_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(workflow_id, workflow_version, node_id) DO UPDATE SET
                      next_due_at = excluded.next_due_at,
                      updated_at = excluded.updated_at
                    """,
                    (workflow_id, workflow_version, node_id, next_due_at, utc_now()),
                )

    def update_run(self, run_id: str, *, status: str, error: str | None = None) -> None:
        timestamp = utc_now()
        with self._lock:
            with self._connection:
                if status == "running":
                    self._connection.execute(
                        "UPDATE runs SET status = ?, started_at = ? WHERE id = ?",
                        (status, timestamp, run_id),
                    )
                elif status in {"succeeded", "failed", "cancelled"}:
                    self._connection.execute(
                        "UPDATE runs SET status = ?, completed_at = ?, error = ? WHERE id = ?",
                        (status, timestamp, error, run_id),
                    )
                else:
                    self._connection.execute(
                        "UPDATE runs SET status = ?, error = ? WHERE id = ?",
                        (status, error, run_id),
                    )

    def set_run_preview_status(self, run_id: str, status: str) -> None:
        if status not in {"complete", "partial"}:
            raise ValueError("Invalid preview status")
        with self._lock, self._connection:
            self._connection.execute("UPDATE runs SET preview_status = ? WHERE id = ?", (status, run_id))

    def request_run_cancel(self, run_id: str) -> bool:
        timestamp = utc_now()
        cancelled_queued_run = False
        with self._lock:
            with self._connection:
                row = self._connection.execute(
                    "SELECT status FROM runs WHERE id = ?", (run_id,)
                ).fetchone()
                if row is None:
                    return False
                if row["status"] == "queued":
                    result = self._connection.execute(
                        """
                        UPDATE runs
                        SET cancel_requested_at = COALESCE(cancel_requested_at, ?),
                            status = 'cancelled',
                            completed_at = ?
                        WHERE id = ? AND status = 'queued'
                        """,
                        (timestamp, timestamp, run_id),
                    )
                    cancelled_queued_run = result.rowcount > 0
                elif row["status"] == "running":
                    self._connection.execute(
                        """
                        UPDATE runs
                        SET cancel_requested_at = COALESCE(cancel_requested_at, ?)
                        WHERE id = ? AND status = 'running'
                        """,
                        (timestamp, run_id),
                    )
                else:
                    return True
        if cancelled_queued_run:
            self.append_event(
                RunEvent(run_id=run_id, type="run_cancel_requested", timestamp=timestamp)
            )
            self.append_event(
                RunEvent(run_id=run_id, type="run_cancelled", timestamp=timestamp)
            )
        return True


    def is_run_cancel_requested(self, run_id: str) -> bool:
        with self._lock:
            row = self._connection.execute(
                "SELECT cancel_requested_at FROM runs WHERE id = ?",
                (run_id,),
            ).fetchone()
            return bool(row and row["cancel_requested_at"])

    def list_workflow_runs(
        self,
        workflow_id: str,
        *,
        limit: int = 10,
        offset: int = 0,
        status: RunStatus | None = None,
    ) -> list[RunRecord]:
        safe_limit = max(1, min(limit, 100))
        safe_offset = max(0, min(offset, 10_000))
        status_clause = " AND r.status = ?" if status else ""
        parameters: tuple[str | int, ...] = (workflow_id, status, safe_limit, safe_offset) if status else (
            workflow_id,
            safe_limit,
            safe_offset,
        )
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT r.*, COALESCE(i.execution_mode, 'manual') AS execution_mode, COALESCE(i.run_mode, 'live') AS run_mode
                FROM runs r
                LEFT JOIN run_invocations i ON i.run_id = r.id
                WHERE r.workflow_id = ?{status_clause}
                ORDER BY r.created_at DESC, r.rowid DESC
                LIMIT ? OFFSET ?
                """.format(status_clause=status_clause),
                parameters,
            ).fetchall()
            return [self._run_record(row) for row in rows]

    def get_run(self, run_id: str) -> RunRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT r.*, COALESCE(i.execution_mode, 'manual') AS execution_mode, COALESCE(i.run_mode, 'live') AS run_mode
                FROM runs r
                LEFT JOIN run_invocations i ON i.run_id = r.id
                WHERE r.id = ?
                """,
                (run_id,),
            ).fetchone()
            if row is None:
                return None
            return self._run_record(row)

    def append_event(self, event: RunEvent) -> None:
        event_data = event.model_dump(mode="json")
        with self._lock:
            with self._connection:
                self._connection.execute(
                    """
                    INSERT INTO run_events (run_id, type, timestamp, node_id, scope_json, payload_json)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        event_data["run_id"],
                        event_data["type"],
                        event_data["timestamp"],
                        event_data["node_id"],
                        json.dumps(event_data["scope"]),
                        json.dumps(event_data["payload"]),
                    ),
                )

    def get_workflow_static_data(self, workflow_id: str) -> dict:
        data, _ = self.get_workflow_static_data_snapshot(workflow_id)
        return data

    def get_workflow_static_data_snapshot(self, workflow_id: str) -> tuple[dict, int]:
        with self._lock:
            row = self._connection.execute(
                "SELECT data_json, revision FROM workflow_static_data WHERE workflow_id = ?",
                (workflow_id,),
            ).fetchone()
        if row is None:
            return {}, 0
        return json.loads(row["data_json"]), int(row["revision"])

    def replace_workflow_static_data(
        self, changes: Mapping[str, tuple[int, dict]]
    ) -> None:
        if not changes:
            return
        timestamp = utc_now()
        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                current_revisions: dict[str, int] = {}
                for workflow_id, (expected_revision, _) in changes.items():
                    row = self._connection.execute(
                        "SELECT revision FROM workflow_static_data WHERE workflow_id = ?",
                        (workflow_id,),
                    ).fetchone()
                    current_revision = int(row["revision"]) if row is not None else 0
                    if current_revision != expected_revision:
                        raise RuntimeError(
                            f"Workflow static data changed concurrently for workflow {workflow_id}"
                        )
                    current_revisions[workflow_id] = current_revision
                for workflow_id, (_, data) in changes.items():
                    previous_revision = current_revisions[workflow_id]
                    next_revision = previous_revision + 1
                    data_json = json.dumps(data, allow_nan=False)
                    if previous_revision == 0:
                        self._connection.execute(
                            """
                            INSERT INTO workflow_static_data (workflow_id, data_json, revision, updated_at)
                            VALUES (?, ?, ?, ?)
                            """,
                            (workflow_id, data_json, next_revision, timestamp),
                        )
                    else:
                        self._connection.execute(
                            """
                            UPDATE workflow_static_data
                            SET data_json = ?, revision = ?, updated_at = ?
                            WHERE workflow_id = ? AND revision = ?
                            """,
                            (
                                data_json,
                                next_revision,
                                timestamp,
                                workflow_id,
                                previous_revision,
                            ),
                        )
                self._connection.commit()
            except Exception:
                self._connection.rollback()
                raise

    def list_events(
        self,
        run_id: str,
        *,
        after_id: int | None = None,
        limit: int | None = None,
    ) -> list[RunEvent]:
        """查询运行事件；支持基于事件自增 id 的增量查询与数量上限。

        不传 after_id / limit 时保持原有全量返回行为。
        """
        query = "SELECT * FROM run_events WHERE run_id = ?"
        parameters: list[str | int] = [run_id]
        if after_id is not None:
            query += " AND id > ?"
            parameters.append(after_id)
        query += " ORDER BY id"
        if limit is not None:
            query += " LIMIT ?"
            parameters.append(limit)
        with self._lock:
            rows = self._connection.execute(query, parameters).fetchall()
            return [
                RunEvent(
                    id=row["id"],
                    run_id=row["run_id"],
                    type=row["type"],
                    timestamp=row["timestamp"],
                    node_id=row["node_id"],
                    scope=json.loads(row["scope_json"]),
                    payload=json.loads(row["payload_json"]),
                )
                for row in rows
            ]
