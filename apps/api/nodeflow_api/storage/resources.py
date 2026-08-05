"""工作区资源仓储：凭据、项目变量、运行环境。"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable
from uuid import uuid4

from ..schemas import (
    CredentialRecord,
    CredentialReference,
    CredentialSummary,
    ProjectEnvironment,
    ProjectVariable,
    WorkflowDocument,
    WorkflowNode,
    WorkflowReference,
)
from .base import _workflow_nodes, utc_now


class WorkspaceResourceMixin:
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
