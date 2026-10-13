"""存储层基础设施：连接管理、schema 初始化与共享辅助。"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from ..schemas import WorkflowDocument, WorkflowNode


class WorkflowVersionConflictError(ValueError):
    def __init__(self, *, workflow_id: str, expected_version: int, current_version: int | None) -> None:
        self.workflow_id = workflow_id
        self.expected_version = expected_version
        self.current_version = current_version
        super().__init__(
            f"workflow {workflow_id} expected version {expected_version}, current version is {current_version}"
        )


def _require_expected_workflow_version(
    *,
    workflow_id: str,
    current_version: int | None,
    expected_version: int | None,
) -> None:
    if expected_version is not None and current_version != expected_version:
        raise WorkflowVersionConflictError(
            workflow_id=workflow_id,
            expected_version=expected_version,
            current_version=current_version,
        )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _workflow_nodes(nodes: list[WorkflowNode]):
    for node in nodes:
        yield node
        for subflow in node.subflows.values():
            yield from _workflow_nodes(subflow.nodes)


class StorageBase:
    """共享的 SQLite 连接与 schema 生命周期。"""

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
                      current_version INTEGER NOT NULL,
                      published_version INTEGER
                    );
                    CREATE TABLE IF NOT EXISTS workflow_versions (
                      workflow_id TEXT NOT NULL,
                      version INTEGER NOT NULL,
                      document_json TEXT NOT NULL,
                      created_at TEXT NOT NULL,
                      PRIMARY KEY (workflow_id, version),
                      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
                    );
                    CREATE TABLE IF NOT EXISTS workflow_version_provenance (
                      workflow_id TEXT NOT NULL,
                      version INTEGER NOT NULL,
                      action TEXT NOT NULL,
                      source_version INTEGER,
                      created_at TEXT NOT NULL,
                      PRIMARY KEY (workflow_id, version),
                      FOREIGN KEY (workflow_id, version)
                        REFERENCES workflow_versions(workflow_id, version) ON DELETE CASCADE
                    );
                    CREATE TABLE IF NOT EXISTS runs (
                      id TEXT PRIMARY KEY,
                      workflow_id TEXT NOT NULL,
                      workflow_version INTEGER NOT NULL,
                      status TEXT NOT NULL,
                      created_at TEXT NOT NULL,
                      started_at TEXT,
                      completed_at TEXT,
                      cancel_requested_at TEXT,
                      parent_run_id TEXT,
                      parent_node_id TEXT,
                      worker_id TEXT,
                      claimed_at TEXT,
                      lease_expires_at TEXT,
                      error TEXT,
                      FOREIGN KEY (workflow_id, workflow_version)
                        REFERENCES workflow_versions(workflow_id, version)
                    );
                    CREATE TABLE IF NOT EXISTS run_events (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      run_id TEXT NOT NULL,
                      type TEXT NOT NULL,
                      timestamp TEXT NOT NULL,
                      node_id TEXT,
                      scope_json TEXT NOT NULL,
                      payload_json TEXT NOT NULL,
                      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
                    );
                    CREATE TABLE IF NOT EXISTS run_invocations (
                      run_id TEXT PRIMARY KEY,
                      entry_node_id TEXT,
                      initial_input_json TEXT NOT NULL,
                      has_initial_input INTEGER NOT NULL DEFAULT 0,
                      execution_mode TEXT NOT NULL,
                      allow_pinned_data INTEGER NOT NULL,
                      project_variables_json TEXT NOT NULL DEFAULT '{}',
                      environment_id TEXT NOT NULL DEFAULT 'default',
                      environment_name TEXT NOT NULL DEFAULT '默认环境',
                      credential_overrides_json TEXT NOT NULL DEFAULT '{}',
                      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
                    );
                    CREATE TABLE IF NOT EXISTS schedule_state (
                      workflow_id TEXT NOT NULL,
                      workflow_version INTEGER NOT NULL,
                      node_id TEXT NOT NULL,
                      next_due_at REAL NOT NULL,
                      updated_at TEXT NOT NULL,
                      PRIMARY KEY (workflow_id, workflow_version, node_id)
                    );
                    CREATE TABLE IF NOT EXISTS credentials (
                      id TEXT PRIMARY KEY,
                      type_id TEXT NOT NULL,
                      name TEXT NOT NULL,
                      encrypted_data TEXT NOT NULL,
                      created_at TEXT NOT NULL,
                      updated_at TEXT NOT NULL,
                      UNIQUE(type_id, name COLLATE NOCASE)
                    );
                    CREATE TABLE IF NOT EXISTS project_variables (
                      name TEXT PRIMARY KEY,
                      value_json TEXT NOT NULL,
                      created_at TEXT NOT NULL,
                      updated_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS project_environments (
                      id TEXT PRIMARY KEY,
                      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                      variables_json TEXT NOT NULL DEFAULT '{}',
                      credential_overrides_json TEXT NOT NULL DEFAULT '{}',
                      created_at TEXT NOT NULL,
                      updated_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS http_profiles (
                      id TEXT PRIMARY KEY,
                      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                      base_url TEXT NOT NULL DEFAULT '',
                      headers_json TEXT NOT NULL DEFAULT '{}',
                      credential_id TEXT,
                      timeout_seconds INTEGER,
                      authentication_json TEXT NOT NULL DEFAULT '{}',
                      created_at TEXT NOT NULL,
                      updated_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS workflow_static_data (
                      workflow_id TEXT PRIMARY KEY,
                      data_json TEXT NOT NULL,
                      revision INTEGER NOT NULL,
                      updated_at TEXT NOT NULL,
                      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
                    );
                    CREATE TABLE IF NOT EXISTS node_package_settings (
                      package_id TEXT PRIMARY KEY,
                      enabled INTEGER NOT NULL DEFAULT 1,
                      locked_version TEXT,
                      updated_at TEXT NOT NULL
                    );
                    """
                )
                run_columns = {
                    row["name"]
                    for row in self._connection.execute("PRAGMA table_info(runs)").fetchall()
                }
                if "cancel_requested_at" not in run_columns:
                    self._connection.execute(
                        "ALTER TABLE runs ADD COLUMN cancel_requested_at TEXT"
                    )
                if "parent_run_id" not in run_columns:
                    self._connection.execute("ALTER TABLE runs ADD COLUMN parent_run_id TEXT")
                if "parent_node_id" not in run_columns:
                    self._connection.execute("ALTER TABLE runs ADD COLUMN parent_node_id TEXT")
                if "worker_id" not in run_columns:
                    self._connection.execute("ALTER TABLE runs ADD COLUMN worker_id TEXT")
                if "claimed_at" not in run_columns:
                    self._connection.execute("ALTER TABLE runs ADD COLUMN claimed_at TEXT")
                if "lease_expires_at" not in run_columns:
                    self._connection.execute("ALTER TABLE runs ADD COLUMN lease_expires_at TEXT")
                workflow_columns = {
                    row["name"]
                    for row in self._connection.execute("PRAGMA table_info(workflows)").fetchall()
                }
                if "published_version" not in workflow_columns:
                    self._connection.execute("ALTER TABLE workflows ADD COLUMN published_version INTEGER")
                    rows = self._connection.execute(
                        """
                        SELECT w.id, w.current_version, v.document_json
                        FROM workflows w
                        JOIN workflow_versions v
                          ON v.workflow_id = w.id AND v.version = w.current_version
                        """
                    ).fetchall()
                    for row in rows:
                        if WorkflowDocument.model_validate_json(row["document_json"]).active:
                            self._connection.execute(
                                "UPDATE workflows SET published_version = ? WHERE id = ?",
                                (row["current_version"], row["id"]),
                            )
                invocation_columns = {
                    row["name"]
                    for row in self._connection.execute("PRAGMA table_info(run_invocations)").fetchall()
                }
                if "has_initial_input" not in invocation_columns:
                    self._connection.execute(
                        "ALTER TABLE run_invocations ADD COLUMN has_initial_input INTEGER NOT NULL DEFAULT 0"
                    )
                if "project_variables_json" not in invocation_columns:
                    self._connection.execute(
                        "ALTER TABLE run_invocations ADD COLUMN project_variables_json TEXT NOT NULL DEFAULT '{}'"
                    )
                if "environment_id" not in invocation_columns:
                    self._connection.execute(
                        "ALTER TABLE run_invocations ADD COLUMN environment_id TEXT NOT NULL DEFAULT 'default'"
                    )
                if "environment_name" not in invocation_columns:
                    self._connection.execute(
                        "ALTER TABLE run_invocations ADD COLUMN environment_name TEXT NOT NULL DEFAULT '默认环境'"
                    )
                if "credential_overrides_json" not in invocation_columns:
                    self._connection.execute(
                        "ALTER TABLE run_invocations ADD COLUMN credential_overrides_json TEXT NOT NULL DEFAULT '{}'"
                    )
                environment_columns = {
                    row["name"]
                    for row in self._connection.execute("PRAGMA table_info(project_environments)").fetchall()
                }
                if "credential_overrides_json" not in environment_columns:
                    self._connection.execute(
                        "ALTER TABLE project_environments ADD COLUMN credential_overrides_json TEXT NOT NULL DEFAULT '{}'"
                    )
                http_profile_columns = {
                    row["name"] for row in self._connection.execute("PRAGMA table_info(http_profiles)").fetchall()
                }
                if "authentication_json" not in http_profile_columns:
                    self._connection.execute(
                        "ALTER TABLE http_profiles ADD COLUMN authentication_json TEXT NOT NULL DEFAULT '{}'"
                    )
                if self._connection.execute(
                    "SELECT 1 FROM project_environments WHERE id = 'default'"
                ).fetchone() is None:
                    timestamp = utc_now()
                    self._connection.execute(
                        """
                        INSERT INTO project_environments (id, name, variables_json, created_at, updated_at)
                        VALUES ('default', '默认环境', ?, ?, ?)
                        """,
                        (json.dumps(self.project_variable_values()), timestamp, timestamp),
                    )

    def close(self) -> None:
        with self._lock:
            self._connection.close()
