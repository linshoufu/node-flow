from pathlib import Path
from textwrap import dedent

import pytest

from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowNode, WorkflowSubflow
from apps.api.nodeflow_api.workflow_node_migrations import (
    WorkflowNodeMigrationError,
    preview_workflow_node_upgrades,
)
from apps.api.nodeflow_api.validation import validate_workflow


def migration_registry(tmp_path: Path) -> NodeRegistry:
    (tmp_path / "versioned.py").write_text(
        dedent(
            """
            from nodeflow_sdk import BaseNode, NodeConfig, node


            class RenameConfig(NodeConfig):
                message: str


            @node(id="test.rename", name="Rename", category="Test", version=3)
            class RenameNode(BaseNode[RenameConfig]):
                @classmethod
                def migrate_config(cls, from_version: int, config: dict):
                    if from_version == 1:
                        return {"text": config["message"]}
                    if from_version == 2:
                        return {"message": config["text"]}
                    return super().migrate_config(from_version, config)


            @node(id="test.no_migration", name="No migration", category="Test", version=2)
            class NoMigrationNode(BaseNode[NodeConfig]):
                pass


            @node(id="test.container", name="Container", category="Test")
            class ContainerNode(BaseNode[NodeConfig]):
                pass


            class ReviewConfig(NodeConfig):
                endpoint: str
                retry: int
                headers: dict[str, str]


            @node(id="test.review", name="Review", category="Test", version=2)
            class ReviewNode(BaseNode[ReviewConfig]):
                @classmethod
                def migrate_config(cls, from_version: int, config: dict):
                    if from_version == 1:
                        return {
                            "endpoint": config["url"],
                            "retry": 3,
                            "headers": {"Accept": "application/json"},
                        }
                    return super().migrate_config(from_version, config)
            """
        ),
        encoding="utf-8",
    )
    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()
    return registry


def node(node_id: str, node_type: str, config: dict, *, type_version: int) -> WorkflowNode:
    return WorkflowNode(
        id=node_id,
        type=node_type,
        position=Position(x=0, y=0),
        config=config,
        typeVersion=type_version,
    )


def test_preview_upgrades_a_node_through_each_intermediate_version(tmp_path: Path):
    workflow = WorkflowDocument(
        id="wf_versioned",
        name="Versioned",
        nodes=[node("rename", "test.rename", {"message": "hello"}, type_version=1)],
        edges=[],
    )

    preview = preview_workflow_node_upgrades(workflow, migration_registry(tmp_path))

    assert preview.workflow.nodes[0].typeVersion == 3
    assert preview.workflow.nodes[0].config == {"message": "hello"}
    assert preview.upgrades[0].node_id == "rename"
    assert preview.upgrades[0].path == "nodes.rename"
    assert preview.upgrades[0].from_version == 1
    assert preview.upgrades[0].to_version == 3


def test_preview_upgrades_nodes_inside_loop_subflows(tmp_path: Path):
    workflow = WorkflowDocument(
        id="wf_nested_versioned",
        name="Nested versioned",
        nodes=[
            WorkflowNode(
                id="loop",
                type="test.container",
                position=Position(x=0, y=0),
                config={"items_expression": "items"},
                subflows={
                    "body": WorkflowSubflow(
                        nodes=[node("rename", "test.rename", {"message": "nested"}, type_version=1)],
                        edges=[],
                    )
                },
            )
        ],
        edges=[],
    )

    preview = preview_workflow_node_upgrades(workflow, migration_registry(tmp_path))

    nested = preview.workflow.nodes[0].subflows["body"].nodes[0]
    assert nested.typeVersion == 3
    assert preview.upgrades[0].path == "nodes.loop.subflows.body.nodes.rename"


def test_preview_includes_config_changes_and_step_notes_for_review(tmp_path: Path):
    workflow = WorkflowDocument(
        id="wf_review",
        name="Review",
        nodes=[
            node(
                "review",
                "test.review",
                {
                    "url": "https://old.example.test",
                    "retry": 1,
                    "legacy": {"token": "old"},
                },
                type_version=1,
            )
        ],
        edges=[],
    )

    preview = preview_workflow_node_upgrades(workflow, migration_registry(tmp_path))

    upgrade = preview.upgrades[0]
    assert [
        (change.path, change.kind, change.before, change.after)
        for change in upgrade.config_changes
    ] == [
        ("config.endpoint", "added", None, "https://old.example.test"),
        ("config.headers", "added", None, {"Accept": "application/json"}),
        ("config.legacy", "removed", {"token": "old"}, None),
        ("config.retry", "changed", 1, 3),
        ("config.url", "removed", "https://old.example.test", None),
    ]
    assert upgrade.migration_notes == [
        "v1 到 v2：新增 config.endpoint、config.headers；修改 config.retry；删除 config.legacy、config.url"
    ]


def test_preview_reports_a_missing_migration_step(tmp_path: Path):
    workflow = WorkflowDocument(
        id="wf_no_migration",
        name="No migration",
        nodes=[node("missing", "test.no_migration", {}, type_version=1)],
        edges=[],
    )

    with pytest.raises(WorkflowNodeMigrationError, match="未定义从版本 1 的迁移函数") as exc_info:
        preview_workflow_node_upgrades(workflow, migration_registry(tmp_path))

    assert exc_info.value.path == "nodes.missing"


def test_validation_requires_an_explicit_upgrade_before_running_an_old_node(tmp_path: Path):
    workflow = WorkflowDocument(
        id="wf_requires_upgrade",
        name="Requires upgrade",
        nodes=[node("rename", "test.rename", {"message": "hello"}, type_version=1)],
        edges=[],
    )

    result = validate_workflow(workflow, migration_registry(tmp_path))

    assert result.valid is False
    assert result.issues[0].path == "nodes.rename.typeVersion"
    assert result.issues[0].message == "节点 test.rename 需要从版本 1 升级到 3"
