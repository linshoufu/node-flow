"""Run-scoped buffering for workflow state that survives successful executions."""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from typing import Any, Literal

from .storage import Storage


StaticDataScope = Literal["workflow", "node"]


@dataclass
class _WorkflowStaticDataSnapshot:
    revision: int
    data: dict[str, Any]


class WorkflowStaticDataTransaction:
    """Stage state mutations until the owning root run completes successfully."""

    def __init__(self, storage: Storage) -> None:
        self._storage = storage
        self._snapshots: dict[str, _WorkflowStaticDataSnapshot] = {}
        self._dirty_workflow_ids: set[str] = set()

    def get(
        self,
        workflow_id: str,
        node_id: str,
        scope: StaticDataScope,
        key: str,
        default: Any = None,
    ) -> Any:
        _validate_key(key)
        section = self._section(workflow_id, node_id, scope)
        return copy.deepcopy(section.get(key, default))

    def set(
        self,
        workflow_id: str,
        node_id: str,
        scope: StaticDataScope,
        key: str,
        value: Any,
    ) -> None:
        _validate_key(key)
        section = self._section(workflow_id, node_id, scope)
        section[key] = _json_copy(value)
        self._dirty_workflow_ids.add(workflow_id)

    def delete(
        self,
        workflow_id: str,
        node_id: str,
        scope: StaticDataScope,
        key: str,
    ) -> None:
        _validate_key(key)
        section = self._section(workflow_id, node_id, scope)
        if key in section:
            del section[key]
            self._dirty_workflow_ids.add(workflow_id)

    def commit(self) -> tuple[str, ...]:
        changes = {
            workflow_id: (self._snapshots[workflow_id].revision, self._snapshots[workflow_id].data)
            for workflow_id in sorted(self._dirty_workflow_ids)
        }
        if not changes:
            return ()
        self._storage.replace_workflow_static_data(changes)
        self._dirty_workflow_ids.clear()
        return tuple(changes)

    def _section(
        self, workflow_id: str, node_id: str, scope: StaticDataScope
    ) -> dict[str, Any]:
        snapshot = self._snapshot(workflow_id)
        if scope == "workflow":
            return snapshot.data["workflow"]
        return snapshot.data["nodes"].setdefault(node_id, {})

    def _snapshot(self, workflow_id: str) -> _WorkflowStaticDataSnapshot:
        snapshot = self._snapshots.get(workflow_id)
        if snapshot is not None:
            return snapshot
        data, revision = self._storage.get_workflow_static_data_snapshot(workflow_id)
        snapshot = _WorkflowStaticDataSnapshot(
            revision=revision,
            data=_normalize_static_data(data),
        )
        self._snapshots[workflow_id] = snapshot
        return snapshot


def _normalize_static_data(value: dict[str, Any]) -> dict[str, Any]:
    workflow = value.get("workflow", {})
    nodes = value.get("nodes", {})
    if not isinstance(workflow, dict) or not isinstance(nodes, dict):
        return {"workflow": {}, "nodes": {}}
    normalized_nodes = {
        str(node_id): node_data
        for node_id, node_data in nodes.items()
        if isinstance(node_data, dict)
    }
    return {"workflow": copy.deepcopy(workflow), "nodes": copy.deepcopy(normalized_nodes)}


def _validate_key(key: str) -> None:
    if not isinstance(key, str) or not key.strip() or len(key) > 120:
        raise ValueError("Workflow static-data keys must be non-empty strings up to 120 characters")


def _json_copy(value: Any) -> Any:
    try:
        return json.loads(json.dumps(value, allow_nan=False))
    except (TypeError, ValueError) as exc:
        raise ValueError("Workflow static-data values must be JSON-serializable") from exc
