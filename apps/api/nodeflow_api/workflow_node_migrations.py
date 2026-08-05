from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from .node_registry import NodeRegistry
from .schemas import WorkflowDocument, WorkflowNode, WorkflowSubflow


class WorkflowNodeMigrationError(ValueError):
    def __init__(self, *, path: str, message: str) -> None:
        super().__init__(message)
        self.path = path
        self.message = message


@dataclass(frozen=True)
class ConfigChange:
    path: str
    kind: str
    before: Any
    after: Any


@dataclass(frozen=True)
class NodeUpgrade:
    node_id: str
    path: str
    node_type: str
    from_version: int
    to_version: int
    config_changes: list[ConfigChange]
    migration_notes: list[str]


@dataclass(frozen=True)
class WorkflowNodeUpgradePreview:
    workflow: WorkflowDocument
    upgrades: list[NodeUpgrade]


def preview_workflow_node_upgrades(
    workflow: WorkflowDocument,
    registry: NodeRegistry,
) -> WorkflowNodeUpgradePreview:
    upgrades: list[NodeUpgrade] = []
    nodes = _upgrade_nodes(workflow.nodes, registry, "nodes", upgrades)
    return WorkflowNodeUpgradePreview(
        workflow=workflow.model_copy(update={"nodes": nodes}),
        upgrades=upgrades,
    )


def _upgrade_nodes(
    nodes: list[WorkflowNode],
    registry: NodeRegistry,
    path_prefix: str,
    upgrades: list[NodeUpgrade],
) -> list[WorkflowNode]:
    return [
        _upgrade_node(node, registry, f"{path_prefix}.{node.id}", upgrades)
        for node in nodes
    ]


def _upgrade_node(
    node: WorkflowNode,
    registry: NodeRegistry,
    path: str,
    upgrades: list[NodeUpgrade],
) -> WorkflowNode:
    if not registry.has(node.type):
        raise WorkflowNodeMigrationError(path=path, message=f"未知节点类型：{node.type}")

    registered_type = registry.get(node.type)
    current_version = registered_type.version
    if node.typeVersion > current_version:
        raise WorkflowNodeMigrationError(
            path=path,
            message=f"节点 {node.type} 保存于版本 {node.typeVersion}，当前脚本只支持到版本 {current_version}",
        )

    migrated_subflows = {
        name: WorkflowSubflow(
            nodes=_upgrade_nodes(
                subflow.nodes,
                registry,
                f"{path}.subflows.{name}.nodes",
                upgrades,
            ),
            edges=subflow.edges,
        )
        for name, subflow in node.subflows.items()
    }
    if node.typeVersion == current_version:
        return node.model_copy(update={"subflows": migrated_subflows})

    config = deepcopy(node.config)
    from_version = node.typeVersion
    migration_notes: list[str] = []
    for version in range(from_version, current_version):
        before_step = config
        try:
            config = registered_type.node_class.migrate_config(version, config)
        except NotImplementedError as exc:
            raise WorkflowNodeMigrationError(path=path, message=str(exc)) from exc
        except Exception as exc:
            raise WorkflowNodeMigrationError(
                path=path,
                message=f"节点 {node.type} 从版本 {version} 迁移失败：{exc}",
            ) from exc
        if not isinstance(config, dict):
            raise WorkflowNodeMigrationError(
                path=path,
                message=f"节点 {node.type} 从版本 {version} 的迁移必须返回配置对象",
            )
        migration_notes.append(
            _migration_note(version, version + 1, _config_changes(before_step, config))
        )

    try:
        registered_type.node_class.config_model().model_validate(config, extra="forbid")
    except ValidationError as exc:
        raise WorkflowNodeMigrationError(
            path=path,
            message=f"节点 {node.type} 迁移后的配置无效：{exc}",
        ) from exc

    upgrades.append(
        NodeUpgrade(
            node_id=node.id,
            path=path,
            node_type=node.type,
            from_version=from_version,
            to_version=current_version,
            config_changes=_config_changes(node.config, config),
            migration_notes=migration_notes,
        )
    )
    return node.model_copy(
        update={
            "config": config,
            "typeVersion": current_version,
            "subflows": migrated_subflows,
        }
    )


def _config_changes(before: Any, after: Any, path: str = "config") -> list[ConfigChange]:
    if isinstance(before, dict) and isinstance(after, dict):
        changes: list[ConfigChange] = []
        for key in sorted(set(before) | set(after)):
            child_path = f"{path}.{key}"
            if key not in before:
                changes.append(ConfigChange(path=child_path, kind="added", before=None, after=after[key]))
            elif key not in after:
                changes.append(ConfigChange(path=child_path, kind="removed", before=before[key], after=None))
            else:
                changes.extend(_config_changes(before[key], after[key], child_path))
        return changes
    if before != after:
        return [ConfigChange(path=path, kind="changed", before=before, after=after)]
    return []


def _migration_note(from_version: int, to_version: int, changes: list[ConfigChange]) -> str:
    labels = {"added": "新增", "changed": "修改", "removed": "删除"}
    parts = [
        f"{labels[kind]} {'、'.join(change.path for change in changes if change.kind == kind)}"
        for kind in ("added", "changed", "removed")
        if any(change.kind == kind for change in changes)
    ]
    detail = "；".join(parts) if parts else "配置无需调整"
    return f"v{from_version} 到 v{to_version}：{detail}"
