from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .schemas import RunEvent, RunRecord, WorkflowDocument, WorkflowSummary


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Storage:
    def __init__(self, database_path: str | Path) -> None:
        self.database_path = str(database_path)
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(self.database_path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA foreign_keys = ON")

    def init_schema(self) -> None:
        with self._lock:
            with self._connection:
                self._connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS workflows (
                      id TEXT PRIMARY KEY,
                      name TEXT NOT NULL,
                      current_version INTEGER NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS workflow_versions (
                      workflow_id TEXT NOT NULL,
                      version INTEGER NOT NULL,
                      document_json TEXT NOT NULL,
                      created_at TEXT NOT NULL,
                      PRIMARY KEY (workflow_id, version)
                    );
                    CREATE TABLE IF NOT EXISTS runs (
                      id TEXT PRIMARY KEY,
                      workflow_id TEXT NOT NULL,
                      workflow_version INTEGER NOT NULL,
                      status TEXT NOT NULL,
                      created_at TEXT NOT NULL,
                      started_at TEXT,
                      completed_at TEXT,
                      error TEXT
                    );
                    CREATE TABLE IF NOT EXISTS run_events (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      run_id TEXT NOT NULL,
                      type TEXT NOT NULL,
                      timestamp TEXT NOT NULL,
                      node_id TEXT,
                      scope_json TEXT NOT NULL,
                      payload_json TEXT NOT NULL
                    );
                    """
                )

    def list_workflows(self) -> list[WorkflowSummary]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT id, name, current_version FROM workflows ORDER BY name"
            ).fetchall()
            return [
                WorkflowSummary(id=row["id"], name=row["name"], version=row["current_version"])
                for row in rows
            ]

    def save_workflow(self, workflow: WorkflowDocument) -> WorkflowDocument:
        with self._lock:
            with self._connection:
                current = self._connection.execute(
                    "SELECT current_version FROM workflows WHERE id = ?",
                    (workflow.id,),
                ).fetchone()
                version = 1 if current is None else int(current["current_version"]) + 1
                saved = workflow.model_copy(update={"version": version})
                self._connection.execute(
                    """
                    INSERT INTO workflows (id, name, current_version)
                    VALUES (?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET name = excluded.name, current_version = excluded.current_version
                    """,
                    (saved.id, saved.name, saved.version),
                )
                self._connection.execute(
                    """
                    INSERT INTO workflow_versions (workflow_id, version, document_json, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (saved.id, saved.version, saved.model_dump_json(), utc_now()),
                )
                return saved

    def get_workflow(self, workflow_id: str, version: int | None = None) -> WorkflowDocument | None:
        with self._lock:
            if version is None:
                row = self._connection.execute(
                    """
                    SELECT v.document_json
                    FROM workflow_versions v
                    JOIN workflows w ON w.id = v.workflow_id AND w.current_version = v.version
                    WHERE w.id = ?
                    """,
                    (workflow_id,),
                ).fetchone()
            else:
                row = self._connection.execute(
                    "SELECT document_json FROM workflow_versions WHERE workflow_id = ? AND version = ?",
                    (workflow_id, version),
                ).fetchone()
            if row is None:
                return None
            return WorkflowDocument.model_validate_json(row["document_json"])

    def create_run(self, workflow: WorkflowDocument) -> RunRecord:
        run = RunRecord(
            id=f"run_{uuid4().hex}",
            workflow_id=workflow.id,
            workflow_version=workflow.version,
            status="queued",
            created_at=utc_now(),
        )
        with self._lock:
            with self._connection:
                self._connection.execute(
                    """
                    INSERT INTO runs (id, workflow_id, workflow_version, status, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (run.id, run.workflow_id, run.workflow_version, run.status, run.created_at),
                )
                return run

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

    def get_run(self, run_id: str) -> RunRecord | None:
        with self._lock:
            row = self._connection.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
            if row is None:
                return None
            return RunRecord(**dict(row))

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

    def list_events(self, run_id: str) -> list[RunEvent]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM run_events WHERE run_id = ? ORDER BY id",
                (run_id,),
            ).fetchall()
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

    def close(self) -> None:
        with self._lock:
            self._connection.close()
