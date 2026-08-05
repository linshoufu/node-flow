from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .schemas import (
    CredentialRecord,
    CredentialReference,
    CredentialSummary,
    ProjectEnvironment,
    ProjectVariable,
    RunEvent,
    RunInvocation,
    RunQueueStatus,
    RunRecord,
    RunStatus,
    WorkflowDocument,
    WorkflowPublicationStatus,
    WorkflowNode,
    WorkflowReference,
    WorkflowSummary,
    WorkflowVersionSummary,
)
from .node_package_lifecycle import NodePackagePolicy


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

    def node_package_policies(self) -> dict[str, NodePackagePolicy]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT package_id, enabled, locked_version, updated_at
                FROM node_package_settings
                ORDER BY package_id
                """
            ).fetchall()
        return {
            row["package_id"]: NodePackagePolicy(
                package_id=row["package_id"],
                enabled=bool(row["enabled"]),
                locked_version=row["locked_version"],
                updated_at=row["updated_at"],
            )
            for row in rows
        }

    def set_node_package_policy(
        self,
        package_id: str,
        *,
        enabled: bool,
        locked_version: str | None,
    ) -> NodePackagePolicy:
        policy = NodePackagePolicy(
            package_id=package_id,
            enabled=enabled,
            locked_version=locked_version,
            updated_at=utc_now(),
        )
        with self._lock:
            with self._connection:
                self._connection.execute(
                    """
                    INSERT INTO node_package_settings (
                      package_id, enabled, locked_version, updated_at
                    )
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(package_id) DO UPDATE SET
                      enabled = excluded.enabled,
                      locked_version = excluded.locked_version,
                      updated_at = excluded.updated_at
                    """,
                    (
                        policy.package_id,
                        int(policy.enabled),
                        policy.locked_version,
                        policy.updated_at,
                    ),
                )
        return policy

    def delete_node_package_policy(self, package_id: str) -> bool:
        with self._lock:
            with self._connection:
                cursor = self._connection.execute(
                    "DELETE FROM node_package_settings WHERE package_id = ?",
                    (package_id,),
                )
        return cursor.rowcount > 0

    def create_credential(
        self,
        *,
        type_id: str,
        name: str,
        encrypted_data: str,
    ) -> CredentialRecord:
        timestamp = utc_now()
        record = CredentialRecord(
            id=f"cred_{uuid4().hex}",
            type_id=type_id,
            name=name.strip(),
            encrypted_data=encrypted_data,
            created_at=timestamp,
            updated_at=timestamp,
        )
        with self._lock:
            with self._connection:
                self._connection.execute(
                    """
                    INSERT INTO credentials (id, type_id, name, encrypted_data, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        record.id,
                        record.type_id,
                        record.name,
                        record.encrypted_data,
                        record.created_at,
                        record.updated_at,
                    ),
                )
        return record

    def list_project_variables(self) -> list[ProjectVariable]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT name, value_json, created_at, updated_at
                FROM project_variables
                ORDER BY name COLLATE NOCASE
                """
            ).fetchall()
        return [
            ProjectVariable(
                name=row["name"],
                value=json.loads(row["value_json"]),
                created_at=row["created_at"],
                updated_at=row["updated_at"],
            )
            for row in rows
        ]

    def project_variable_values(self) -> dict[str, object]:
        return {variable.name: variable.value for variable in self.list_project_variables()}

    def create_project_variable(self, *, name: str, value: object) -> ProjectVariable:
        timestamp = utc_now()
        variable = ProjectVariable(name=name, value=value, created_at=timestamp, updated_at=timestamp)
        with self._lock:
            with self._connection:
                self._connection.execute(
                    """
                    INSERT INTO project_variables (name, value_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (variable.name, json.dumps(variable.value), variable.created_at, variable.updated_at),
                )
        return variable

    def update_project_variable(self, name: str, *, value: object) -> ProjectVariable | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT name, created_at FROM project_variables WHERE name = ?", (name,)
            ).fetchone()
            if row is None:
                return None
            variable = ProjectVariable(
                name=row["name"],
                value=value,
                created_at=row["created_at"],
                updated_at=utc_now(),
            )
            with self._connection:
                self._connection.execute(
                    """
                    UPDATE project_variables
                    SET value_json = ?, updated_at = ?
                    WHERE name = ?
                    """,
                    (json.dumps(variable.value), variable.updated_at, variable.name),
                )
        return variable

    def delete_project_variable(self, name: str) -> bool:
        with self._lock:
            with self._connection:
                result = self._connection.execute("DELETE FROM project_variables WHERE name = ?", (name,))
        return result.rowcount > 0

    def list_project_environments(self) -> list[ProjectEnvironment]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT id, name, variables_json, credential_overrides_json, created_at, updated_at
                FROM project_environments
                ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END, name COLLATE NOCASE
                """
            ).fetchall()
        default_variables = self.project_variable_values()
        return [
            ProjectEnvironment(
                id=row["id"],
                name=row["name"],
                variables=default_variables if row["id"] == "default" else json.loads(row["variables_json"]),
                credential_overrides=json.loads(row["credential_overrides_json"] or "{}"),
                is_default=row["id"] == "default",
                created_at=row["created_at"],
                updated_at=row["updated_at"],
            )
            for row in rows
        ]

    def get_project_environment(self, environment_id: str) -> ProjectEnvironment | None:
        return next(
            (
                environment
                for environment in self.list_project_environments()
                if environment.id == environment_id
            ),
            None,
        )

    def create_project_environment(
        self, *, name: str, variables: dict[str, object], credential_overrides: dict[str, str] | None = None
    ) -> ProjectEnvironment:
        timestamp = utc_now()
        environment = ProjectEnvironment(
            id=f"env_{uuid4().hex}",
            name=name,
            variables=variables,
            credential_overrides=credential_overrides or {},
            created_at=timestamp,
            updated_at=timestamp,
        )
        with self._lock:
            with self._connection:
                self._connection.execute(
                    """
                    INSERT INTO project_environments
                      (id, name, variables_json, credential_overrides_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        environment.id,
                        environment.name,
                        json.dumps(environment.variables),
                        json.dumps(environment.credential_overrides),
                        environment.created_at,
                        environment.updated_at,
                    ),
                )
        return environment

    def update_project_environment(
        self,
        environment_id: str,
        *,
        name: str | None = None,
        variables: dict[str, object] | None = None,
        credential_overrides: dict[str, str] | None = None,
    ) -> ProjectEnvironment | None:
        environment = self.get_project_environment(environment_id)
        if environment is None:
            return None
        if environment.is_default and variables is not None:
            raise ValueError("默认环境变量请通过项目变量管理")
        updated = environment.model_copy(
            update={
                "name": name if name is not None else environment.name,
                "variables": variables if variables is not None else environment.variables,
                "credential_overrides": credential_overrides if credential_overrides is not None else environment.credential_overrides,
                "updated_at": utc_now(),
            }
        )
        with self._lock:
            with self._connection:
                self._connection.execute(
                    """
                    UPDATE project_environments
                    SET name = ?, variables_json = ?, credential_overrides_json = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        updated.name,
                        json.dumps(updated.variables),
                        json.dumps(updated.credential_overrides),
                        updated.updated_at,
                        environment_id,
                    ),
                )
        return updated

    def delete_project_environment(self, environment_id: str) -> bool:
        if environment_id == "default":
            raise ValueError("不能删除默认环境")
        if self.environment_is_referenced(environment_id):
            raise ValueError("运行环境仍被工作流使用")
        with self._lock:
            with self._connection:
                result = self._connection.execute(
                    "DELETE FROM project_environments WHERE id = ?", (environment_id,)
                )
        return result.rowcount > 0

    def environment_is_referenced(self, environment_id: str) -> bool:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT v.document_json
                FROM workflows w
                JOIN workflow_versions v ON v.workflow_id = w.id AND v.version = w.current_version
                """
            ).fetchall()
        return any(
            WorkflowDocument.model_validate_json(row["document_json"]).settings.environment_id
            == environment_id
            for row in rows
        )

    def list_environment_credential_references(self, credential_id: str) -> list[ProjectEnvironment]:
        return [
            environment
            for environment in self.list_project_environments()
            if credential_id in environment.credential_overrides
            or credential_id in environment.credential_overrides.values()
        ]

    def list_credentials(self) -> list[CredentialSummary]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT id, type_id, name, created_at, updated_at
                FROM credentials
                ORDER BY name COLLATE NOCASE, id
                """
            ).fetchall()
        return [CredentialSummary(**dict(row)) for row in rows]

    def get_credential(self, credential_id: str) -> CredentialRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT id, type_id, name, encrypted_data, created_at, updated_at FROM credentials WHERE id = ?",
                (credential_id,),
            ).fetchone()
        return CredentialRecord(**dict(row)) if row is not None else None

    def update_credential(
        self,
        credential_id: str,
        *,
        name: str | None = None,
        encrypted_data: str | None = None,
    ) -> CredentialRecord | None:
        current = self.get_credential(credential_id)
        if current is None:
            return None
        updated = current.model_copy(
            update={
                "name": name.strip() if name is not None else current.name,
                "encrypted_data": encrypted_data if encrypted_data is not None else current.encrypted_data,
                "updated_at": utc_now(),
            }
        )
        with self._lock:
            with self._connection:
                self._connection.execute(
                    """
                    UPDATE credentials
                    SET name = ?, encrypted_data = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (updated.name, updated.encrypted_data, updated.updated_at, credential_id),
                )
        return updated

    def delete_credential(self, credential_id: str) -> bool:
        with self._lock:
            with self._connection:
                result = self._connection.execute("DELETE FROM credentials WHERE id = ?", (credential_id,))
        return result.rowcount > 0

    def list_credential_references(
        self,
        credential_id: str,
        *,
        credential_ids_for_node: Callable[[WorkflowNode], Iterable[str]] | None = None,
    ) -> list[CredentialReference]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT w.id AS workflow_id, v.document_json
                FROM workflows w
                JOIN workflow_versions v
                  ON v.workflow_id = w.id AND v.version = w.current_version
                ORDER BY w.name COLLATE NOCASE, w.id
                """
            ).fetchall()

        references: list[CredentialReference] = []
        for row in rows:
            workflow = WorkflowDocument.model_validate_json(row["document_json"])
            for node in _workflow_nodes(workflow.nodes):
                configured_credential_ids = (
                    credential_ids_for_node(node)
                    if credential_ids_for_node is not None
                    else (node.config.get("credential_id"),)
                )
                if credential_id not in configured_credential_ids:
                    continue
                references.append(
                    CredentialReference(
                        workflow_id=workflow.id,
                        workflow_name=workflow.name,
                        node_id=node.id,
                        node_label=node.label or node.id,
                    )
                )
        return references

    def list_node_type_references(
        self,
        node_type_ids: Iterable[str],
    ) -> list[WorkflowReference]:
        target_ids = set(node_type_ids)
        if not target_ids:
            return []
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT w.id AS workflow_id, v.document_json
                FROM workflows w
                JOIN workflow_versions v
                  ON v.workflow_id = w.id AND v.version = w.current_version
                ORDER BY w.name COLLATE NOCASE, w.id
                """
            ).fetchall()

        references: list[WorkflowReference] = []
        for row in rows:
            workflow = WorkflowDocument.model_validate_json(row["document_json"])
            for node in _workflow_nodes(workflow.nodes):
                if node.type not in target_ids:
                    continue
                references.append(
                    WorkflowReference(
                        workflow_id=workflow.id,
                        workflow_name=workflow.name,
                        node_id=node.id,
                        node_label=node.label or node.id,
                    )
                )
        return references

    def list_workflow_references(self, workflow_id: str) -> list[WorkflowReference]:
        with self._lock:
            return self._workflow_references_locked(workflow_id)

    def delete_workflow(self, workflow_id: str) -> tuple[str, list[WorkflowReference]]:
        with self._lock:
            with self._connection:
                exists = self._connection.execute(
                    "SELECT 1 FROM workflows WHERE id = ?",
                    (workflow_id,),
                ).fetchone()
                if exists is None:
                    return "not_found", []

                references = self._workflow_references_locked(workflow_id)
                if references:
                    return "referenced", references

                open_run = self._connection.execute(
                    """
                    SELECT 1 FROM runs
                    WHERE workflow_id = ? AND status IN ('queued', 'running')
                    LIMIT 1
                    """,
                    (workflow_id,),
                ).fetchone()
                if open_run is not None:
                    return "open_runs", []

                self._connection.execute("DELETE FROM schedule_state WHERE workflow_id = ?", (workflow_id,))
                self._connection.execute("DELETE FROM runs WHERE workflow_id = ?", (workflow_id,))
                # Keep deletion correct for databases created before cascading version
                # provenance constraints were introduced.
                self._connection.execute(
                    "DELETE FROM workflow_version_provenance WHERE workflow_id = ?",
                    (workflow_id,),
                )
                self._connection.execute(
                    "DELETE FROM workflow_versions WHERE workflow_id = ?",
                    (workflow_id,),
                )
                self._connection.execute("DELETE FROM workflows WHERE id = ?", (workflow_id,))
                return "deleted", []

    def list_workflows(self) -> list[WorkflowSummary]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT
                  w.id,
                  w.name,
                  w.current_version,
                  w.published_version,
                  v.document_json,
                  v.created_at AS updated_at,
                  latest_run.status AS last_run_status
                FROM workflows w
                JOIN workflow_versions v
                  ON v.workflow_id = w.id AND v.version = w.current_version
                LEFT JOIN runs latest_run
                  ON latest_run.id = (
                    SELECT r.id
                    FROM runs r
                    WHERE r.workflow_id = w.id
                    ORDER BY r.created_at DESC, r.rowid DESC
                    LIMIT 1
                  )
                ORDER BY w.name
                """
            ).fetchall()
            return [_workflow_summary_from_row(row) for row in rows]

    def _workflow_references_locked(self, workflow_id: str) -> list[WorkflowReference]:
        rows = self._connection.execute(
            """
            SELECT w.id AS workflow_id, v.document_json
            FROM workflows w
            JOIN workflow_versions v
              ON v.workflow_id = w.id AND v.version = w.current_version
            WHERE w.id != ?
            ORDER BY w.name COLLATE NOCASE, w.id
            """,
            (workflow_id,),
        ).fetchall()
        references: list[WorkflowReference] = []
        for row in rows:
            workflow = WorkflowDocument.model_validate_json(row["document_json"])
            if workflow.settings.error_workflow_id == workflow_id:
                references.append(
                    WorkflowReference(
                        workflow_id=workflow.id,
                        workflow_name=workflow.name,
                        node_id="workflow.settings.error_workflow_id",
                        node_label="错误处理工作流",
                    )
                )
            for node in _workflow_nodes(workflow.nodes):
                if node.type != "workflow.execute" or node.config.get("workflow_id") != workflow_id:
                    continue
                references.append(
                    WorkflowReference(
                        workflow_id=workflow.id,
                        workflow_name=workflow.name,
                        node_id=node.id,
                        node_label=node.label or node.id,
                    )
                )
        return references

    def list_active_workflows(self) -> list[WorkflowDocument]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT v.document_json
                FROM workflow_versions v
                JOIN workflows w ON w.id = v.workflow_id AND w.published_version = v.version
                WHERE w.published_version IS NOT NULL
                """
            ).fetchall()
        return [
            WorkflowDocument.model_validate_json(row["document_json"]).model_copy(update={"active": True})
            for row in rows
        ]

    def save_workflow(
        self,
        workflow: WorkflowDocument,
        *,
        publish: bool | None = None,
        action: Literal["save", "restore", "rollback"] = "save",
        source_version: int | None = None,
        expected_version: int | None = None,
    ) -> WorkflowDocument:
        with self._lock:
            with self._connection:
                current = self._connection.execute(
                    "SELECT current_version, published_version FROM workflows WHERE id = ?",
                    (workflow.id,),
                ).fetchone()
                current_version = int(current["current_version"]) if current is not None else None
                _require_expected_workflow_version(
                    workflow_id=workflow.id,
                    current_version=current_version,
                    expected_version=expected_version,
                )
                if current is None:
                    # Repair history left by databases that predate cascading deletes.
                    self._connection.execute(
                        "DELETE FROM workflow_version_provenance WHERE workflow_id = ?",
                        (workflow.id,),
                    )
                    self._connection.execute(
                        "DELETE FROM workflow_versions WHERE workflow_id = ?",
                        (workflow.id,),
                    )
                version = 1 if current is None else int(current["current_version"]) + 1
                should_publish = workflow.active if publish is None else publish
                published_version = (
                    version
                    if should_publish
                    else (int(current["published_version"]) if current and current["published_version"] is not None else None)
                )
                saved = workflow.model_copy(update={"version": version, "active": should_publish})
                self._connection.execute(
                    """
                    INSERT INTO workflows (id, name, current_version, published_version)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      name = excluded.name,
                      current_version = excluded.current_version,
                      published_version = excluded.published_version
                    """,
                    (saved.id, saved.name, saved.version, published_version),
                )
                self._connection.execute(
                    """
                    INSERT INTO workflow_versions (workflow_id, version, document_json, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (saved.id, saved.version, saved.model_dump_json(), utc_now()),
                )
                self._connection.execute(
                    """
                    INSERT INTO workflow_version_provenance
                      (workflow_id, version, action, source_version, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (saved.id, saved.version, action, source_version, utc_now()),
                )
                return saved.model_copy(update={"active": published_version is not None})

    def rollback_workflow_version(
        self,
        workflow_id: str,
        source_version: int,
        *,
        expected_version: int | None = None,
    ) -> WorkflowDocument | None:
        """Create and publish a new version copied from a historical production version."""
        with self._lock:
            with self._connection:
                current = self._connection.execute(
                    "SELECT current_version, published_version FROM workflows WHERE id = ?",
                    (workflow_id,),
                ).fetchone()
                if current is None or current["published_version"] is None:
                    return None
                _require_expected_workflow_version(
                    workflow_id=workflow_id,
                    current_version=int(current["current_version"]),
                    expected_version=expected_version,
                )

                source = self._connection.execute(
                    """
                    SELECT document_json FROM workflow_versions
                    WHERE workflow_id = ? AND version = ?
                    """,
                    (workflow_id, source_version),
                ).fetchone()
                if source is None:
                    return None

                version = int(current["current_version"]) + 1
                rolled_back = WorkflowDocument.model_validate_json(source["document_json"]).model_copy(
                    update={"version": version, "active": True}
                )
                self._connection.execute(
                    """
                    UPDATE workflows
                    SET name = ?, current_version = ?, published_version = ?
                    WHERE id = ?
                    """,
                    (rolled_back.name, version, version, workflow_id),
                )
                created_at = utc_now()
                self._connection.execute(
                    """
                    INSERT INTO workflow_versions (workflow_id, version, document_json, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (workflow_id, version, rolled_back.model_dump_json(), created_at),
                )
                self._connection.execute(
                    """
                    INSERT INTO workflow_version_provenance
                      (workflow_id, version, action, source_version, created_at)
                    VALUES (?, ?, 'rollback', ?, ?)
                    """,
                    (workflow_id, version, source_version, created_at),
                )
                return rolled_back

    def publish_workflow(
        self,
        workflow_id: str,
        *,
        expected_version: int | None = None,
    ) -> WorkflowDocument | None:
        with self._lock:
            with self._connection:
                row = self._connection.execute(
                    """
                    SELECT w.current_version, v.document_json
                    FROM workflows w
                    JOIN workflow_versions v
                      ON v.workflow_id = w.id AND v.version = w.current_version
                    WHERE w.id = ?
                    """,
                    (workflow_id,),
                ).fetchone()
                if row is None:
                    return None
                _require_expected_workflow_version(
                    workflow_id=workflow_id,
                    current_version=int(row["current_version"]),
                    expected_version=expected_version,
                )
                self._connection.execute(
                    "UPDATE workflows SET published_version = ? WHERE id = ?",
                    (row["current_version"], workflow_id),
                )
                return WorkflowDocument.model_validate_json(row["document_json"]).model_copy(
                    update={"active": True}
                )

    def unpublish_workflow(
        self,
        workflow_id: str,
        *,
        expected_version: int | None = None,
    ) -> WorkflowDocument | None:
        with self._lock:
            with self._connection:
                row = self._connection.execute(
                    """
                    SELECT w.current_version, v.document_json
                    FROM workflows w
                    JOIN workflow_versions v
                      ON v.workflow_id = w.id AND v.version = w.current_version
                    WHERE w.id = ?
                    """,
                    (workflow_id,),
                ).fetchone()
                if row is None:
                    return None
                _require_expected_workflow_version(
                    workflow_id=workflow_id,
                    current_version=int(row["current_version"]),
                    expected_version=expected_version,
                )
                self._connection.execute(
                    "UPDATE workflows SET published_version = NULL WHERE id = ?",
                    (workflow_id,),
                )
                return WorkflowDocument.model_validate_json(row["document_json"]).model_copy(
                    update={"active": False}
                )

    def get_published_workflow(self, workflow_id: str) -> WorkflowDocument | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT v.document_json
                FROM workflows w
                JOIN workflow_versions v
                  ON v.workflow_id = w.id AND v.version = w.published_version
                WHERE w.id = ? AND w.published_version IS NOT NULL
                """,
                (workflow_id,),
            ).fetchone()
        if row is None:
            return None
        return WorkflowDocument.model_validate_json(row["document_json"]).model_copy(update={"active": True})

    def get_workflow_publication_status(
        self, workflow_id: str
    ) -> WorkflowPublicationStatus | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT current_version, published_version FROM workflows WHERE id = ?",
                (workflow_id,),
            ).fetchone()
        if row is None:
            return None
        published_version = row["published_version"]
        return WorkflowPublicationStatus(
            workflow_id=workflow_id,
            draft_version=row["current_version"],
            published_version=published_version,
            active=published_version is not None,
            has_unpublished_changes=published_version != row["current_version"],
        )

    def get_workflow(self, workflow_id: str, version: int | None = None) -> WorkflowDocument | None:
        with self._lock:
            if version is None:
                row = self._connection.execute(
                    """
                    SELECT v.document_json, w.published_version
                    FROM workflow_versions v
                    JOIN workflows w ON w.id = v.workflow_id AND w.current_version = v.version
                    WHERE w.id = ?
                    """,
                    (workflow_id,),
                ).fetchone()
            else:
                row = self._connection.execute(
                    """
                    SELECT v.document_json, w.published_version
                    FROM workflow_versions v
                    JOIN workflows w ON w.id = v.workflow_id
                    WHERE v.workflow_id = ? AND v.version = ?
                    """,
                    (workflow_id, version),
                ).fetchone()
            if row is None:
                return None
            document = WorkflowDocument.model_validate_json(row["document_json"])
            if version is not None:
                return document
            return document.model_copy(update={"active": row["published_version"] is not None})

    def list_workflow_versions(self, workflow_id: str) -> list[WorkflowVersionSummary]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT v.version, v.document_json, v.created_at, w.published_version,
                       COALESCE(p.action, 'save') AS action, p.source_version
                FROM workflow_versions v
                JOIN workflows w ON w.id = v.workflow_id
                LEFT JOIN workflow_version_provenance p
                  ON p.workflow_id = v.workflow_id AND p.version = v.version
                WHERE v.workflow_id = ?
                ORDER BY v.version DESC
                """,
                (workflow_id,),
            ).fetchall()
        return [
            WorkflowVersionSummary(
                version=row["version"],
                created_at=row["created_at"],
                name=document.name,
                active=row["published_version"] == row["version"],
                node_count=len(document.nodes),
                action=row["action"],
                source_version=row["source_version"],
            )
            for row in rows
            for document in [WorkflowDocument.model_validate_json(row["document_json"])]
        ]

    def find_webhook_binding(
        self,
        *,
        method: str,
        path: str,
        exclude_workflow_id: str | None = None,
    ) -> tuple[WorkflowDocument, str] | None:
        normalized_path = _normalize_webhook_path(path)
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT v.document_json
                FROM workflow_versions v
                JOIN workflows w ON w.id = v.workflow_id AND w.published_version = v.version
                WHERE w.published_version IS NOT NULL
                """
            ).fetchall()
        for row in rows:
            workflow = WorkflowDocument.model_validate_json(row["document_json"])
            if workflow.id == exclude_workflow_id:
                continue
            for node in workflow.nodes:
                if node.type != "webhook.trigger" or node.disabled:
                    continue
                if (
                    str(node.config.get("method", "POST")).upper() == method.upper()
                    and _normalize_webhook_path(str(node.config.get("path", ""))) == normalized_path
                ):
                    return workflow, node.id
        return None

    def create_run(
        self,
        workflow: WorkflowDocument,
        *,
        parent_run_id: str | None = None,
        parent_node_id: str | None = None,
        invocation: RunInvocation | None = None,
    ) -> RunRecord:
        invocation = invocation or RunInvocation()
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
                      project_variables_json, environment_id, environment_name, credential_overrides_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            allow_pinned_data=bool(row["allow_pinned_data"]),
            project_variables=json.loads(row["project_variables_json"] or "{}"),
            environment_id=row["environment_id"],
            environment_name=row["environment_name"],
            credential_overrides=json.loads(row["credential_overrides_json"] or "{}"),
        )

    def list_runs_requiring_recovery(self) -> list[RunRecord]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM runs
                WHERE status IN ('queued', 'running')
                ORDER BY created_at, id
                """
            ).fetchall()
        return [RunRecord(**dict(row)) for row in rows]

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
                    ORDER BY r.created_at, r.id
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
        return RunRecord(**dict(claimed)) if claimed is not None else None

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
                SELECT r.*, i.execution_mode
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
                  AND (r.created_at < ? OR (r.created_at = ? AND r.id <= ?))
                """,
                (row["created_at"], row["created_at"], run_id),
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
                SELECT r.*, COALESCE(i.execution_mode, 'manual') AS execution_mode
                FROM runs r
                LEFT JOIN run_invocations i ON i.run_id = r.id
                WHERE r.workflow_id = ?{status_clause}
                ORDER BY r.created_at DESC, r.rowid DESC
                LIMIT ? OFFSET ?
                """.format(status_clause=status_clause),
                parameters,
            ).fetchall()
            return [RunRecord(**dict(row)) for row in rows]

    def get_run(self, run_id: str) -> RunRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT r.*, COALESCE(i.execution_mode, 'manual') AS execution_mode
                FROM runs r
                LEFT JOIN run_invocations i ON i.run_id = r.id
                WHERE r.id = ?
                """,
                (run_id,),
            ).fetchone()
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


def _workflow_summary_from_row(row: sqlite3.Row) -> WorkflowSummary:
    document = json.loads(row["document_json"])
    return WorkflowSummary(
        id=row["id"],
        name=row["name"],
        active=row["published_version"] is not None,
        description=document.get("description", ""),
        tags=document.get("tags", []),
        version=row["current_version"],
        updated_at=row["updated_at"],
        node_count=_count_workflow_nodes(document),
        last_run_status=row["last_run_status"],
    )


def _count_workflow_nodes(document: dict) -> int:
    return _count_nodes(document.get("nodes", []))


def _count_nodes(nodes: list[dict]) -> int:
    total = len(nodes)
    for node in nodes:
        for subflow in node.get("subflows", {}).values():
            total += _count_nodes(subflow.get("nodes", []))
    return total


def _normalize_webhook_path(path: str) -> str:
    return path.strip().strip("/")
