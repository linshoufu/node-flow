"""工作流仓储：文档版本、发布状态、引用与 Webhook 绑定。"""

from __future__ import annotations

import json
import sqlite3
from typing import Literal

from ..schemas import (
    WorkflowDocument,
    WorkflowPublicationStatus,
    WorkflowReference,
    WorkflowSummary,
    WorkflowVersionSummary,
)
from .base import (
    _require_expected_workflow_version,
    _workflow_nodes,
    utc_now,
)


class WorkflowRepositoryMixin:
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
