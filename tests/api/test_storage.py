import sqlite3
from datetime import datetime, timezone

import pytest

from apps.api.nodeflow_api.schemas import (
    CanvasAnnotation,
    Position,
    RunEvent,
    WorkflowDocument,
    WorkflowEdge,
    WorkflowNode,
    WorkflowSubflow,
)
from apps.api.nodeflow_api.storage import Storage, WorkflowVersionConflictError, utc_now


def workflow_document(name: str = "Demo Workflow") -> WorkflowDocument:
    return WorkflowDocument(
        id="workflow_1",
        name=name,
        nodes=[
            WorkflowNode(
                id="node_1",
                type="manual.trigger",
                position=Position(x=10, y=20),
                config={"label": "Start", "enabled": True},
                notes="  准备发布输入。  ",
                subflows={
                    "success": WorkflowSubflow(
                        nodes=[
                            WorkflowNode(
                                id="nested_1",
                                type="http.request",
                                position=Position(x=30, y=40),
                                config={"url": "https://example.com"},
                            )
                        ],
                        edges=[],
                    )
                },
            ),
            WorkflowNode(
                id="node_2",
                type="http.request",
                position=Position(x=50, y=60),
                config={"method": "GET", "url": "https://example.com"},
            ),
        ],
        edges=[
            WorkflowEdge(
                id="edge_1",
                source="node_1",
                sourceHandle="success",
                target="node_2",
                targetHandle="input",
            )
        ],
    )


def test_node_package_policy_round_trips_and_updates_atomically():
    storage = Storage(":memory:")
    storage.init_schema()

    first = storage.set_node_package_policy(
        "example.tools",
        enabled=False,
        locked_version="1.2.0",
    )
    second = storage.set_node_package_policy(
        "example.tools",
        enabled=True,
        locked_version=None,
    )

    assert first.enabled is False
    assert first.locked_version == "1.2.0"
    assert second.enabled is True
    assert second.locked_version is None
    assert storage.node_package_policies() == {"example.tools": second}
    assert storage.delete_node_package_policy("example.tools") is True
    assert storage.delete_node_package_policy("example.tools") is False
    assert storage.node_package_policies() == {}
    storage.close()


def test_workflow_versions_latest_history_and_summaries_round_trip():
    storage = Storage(":memory:")
    storage.init_schema()

    first = storage.save_workflow(workflow_document())
    second = storage.save_workflow(workflow_document(name="Renamed Workflow"))

    assert first.version == 1
    assert second.version == 2
    assert storage.get_workflow("workflow_1") == second
    assert storage.get_workflow("workflow_1", version=1) == first
    assert first.nodes[0].config == {"label": "Start", "enabled": True}
    assert first.nodes[0].notes == "准备发布输入。"
    assert first.nodes[0].subflows["success"].nodes[0].config == {"url": "https://example.com"}
    assert first.edges[0].sourceHandle == "success"
    summary = storage.list_workflows()[0]
    assert summary.model_dump() == {
        "id": "workflow_1",
        "name": "Renamed Workflow",
        "active": True,
        "description": "",
        "tags": [],
        "version": 2,
        "updated_at": summary.updated_at,
        "node_count": 3,
        "last_run_status": None,
    }
    assert summary.updated_at is not None

    storage.close()


def test_workflow_save_rejects_a_stale_expected_version_without_creating_history():
    storage = Storage(":memory:")
    storage.init_schema()
    first = storage.save_workflow(workflow_document())
    second = storage.save_workflow(
        workflow_document(name="Second"),
        expected_version=first.version,
    )

    with pytest.raises(WorkflowVersionConflictError) as conflict:
        storage.save_workflow(
            workflow_document(name="Stale overwrite"),
            expected_version=first.version,
        )

    assert conflict.value.expected_version == 1
    assert conflict.value.current_version == 2
    assert storage.get_workflow("workflow_1") == second
    assert [item.version for item in storage.list_workflow_versions("workflow_1")] == [2, 1]
    storage.close()


def test_workflow_mutations_reject_a_stale_expected_version_without_changing_state():
    storage = Storage(":memory:")
    storage.init_schema()
    first = storage.save_workflow(workflow_document())
    second = storage.save_workflow(
        workflow_document(name="Current"),
        expected_version=first.version,
    )

    operations = (
        lambda: storage.publish_workflow("workflow_1", expected_version=first.version),
        lambda: storage.unpublish_workflow("workflow_1", expected_version=first.version),
        lambda: storage.rollback_workflow_version(
            "workflow_1",
            first.version,
            expected_version=first.version,
        ),
    )
    for operation in operations:
        with pytest.raises(WorkflowVersionConflictError) as conflict:
            operation()
        assert conflict.value.expected_version == first.version
        assert conflict.value.current_version == second.version

    assert storage.get_workflow("workflow_1") == second
    assert storage.get_workflow_publication_status("workflow_1").published_version == second.version
    assert [item.version for item in storage.list_workflow_versions("workflow_1")] == [2, 1]
    storage.close()


def test_delete_workflow_explicitly_cleans_version_history_before_reusing_its_id():
    storage = Storage(":memory:")
    storage.init_schema()
    storage.save_workflow(workflow_document())
    storage._connection.execute("PRAGMA foreign_keys = OFF")

    outcome, references = storage.delete_workflow("workflow_1")
    recreated = storage.save_workflow(workflow_document(name="Recreated"))

    assert outcome == "deleted"
    assert references == []
    assert recreated.version == 1
    assert storage.get_workflow("workflow_1") == recreated
    assert [item.version for item in storage.list_workflow_versions("workflow_1")] == [1]
    storage.close()


def test_save_workflow_repairs_orphaned_legacy_version_history():
    storage = Storage(":memory:")
    storage.init_schema()
    storage.save_workflow(workflow_document())
    storage._connection.execute("PRAGMA foreign_keys = OFF")
    storage._connection.execute("DELETE FROM workflows WHERE id = ?", ("workflow_1",))
    storage._connection.commit()

    recreated = storage.save_workflow(workflow_document(name="Recreated"))

    assert recreated.version == 1
    assert storage.get_workflow("workflow_1") == recreated
    assert [item.version for item in storage.list_workflow_versions("workflow_1")] == [1]
    storage.close()


def test_delete_workflow_rejects_error_workflow_references():
    storage = Storage(":memory:")
    storage.init_schema()
    error_handler = storage.save_workflow(
        WorkflowDocument(id="wf_error_handler", name="Error handler", nodes=[], edges=[])
    )
    storage.save_workflow(
        WorkflowDocument(
            id="wf_parent",
            name="Parent",
            settings={"error_workflow_id": error_handler.id},
            nodes=[],
            edges=[],
        )
    )

    outcome, references = storage.delete_workflow(error_handler.id)

    assert outcome == "referenced"
    assert references[0].workflow_id == "wf_parent"
    assert references[0].node_id == "workflow.settings.error_workflow_id"


def test_canvas_annotations_round_trip_without_entering_node_execution_data():
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = WorkflowDocument(
        id="workflow_annotations",
        name="Annotated workflow",
        annotations=[
            CanvasAnnotation(
                id="annotation_prepare",
                content="  Prepare the request payload.  ",
                position=Position(x=12, y=24),
                width=360,
                height=180,
                color="yellow",
            )
        ],
        nodes=[],
        edges=[],
    )

    saved = storage.save_workflow(workflow)
    loaded = storage.get_workflow(saved.id)

    assert loaded is not None
    assert loaded.annotations[0].content == "Prepare the request payload."
    assert loaded.annotations[0].model_dump() == {
        "id": "annotation_prepare",
        "content": "Prepare the request payload.",
        "position": {"x": 12.0, "y": 24.0},
        "width": 360.0,
        "height": 180.0,
        "color": "yellow",
    }
    assert loaded.nodes == []

    storage.close()


def test_workflow_metadata_round_trips_through_versions_and_summaries():
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = WorkflowDocument(
        id="workflow_metadata",
        name="Release pipeline",
        description="Builds and publishes the release artifact.",
        tags=["release", "automation"],
        active=False,
        nodes=[],
        edges=[],
    )

    saved = storage.save_workflow(workflow)
    summary = storage.list_workflows()[0]

    assert storage.get_workflow(saved.id) == saved
    assert saved.description == "Builds and publishes the release artifact."
    assert saved.tags == ["release", "automation"]
    assert summary.description == saved.description
    assert summary.tags == saved.tags
    assert summary.active is False

    storage.close()


def test_workflow_summaries_include_latest_run_status():
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = storage.save_workflow(workflow_document())

    first_run = storage.create_run(workflow)
    storage.update_run(first_run.id, status="failed", error="boom")
    second_run = storage.create_run(workflow)
    storage.update_run(second_run.id, status="running")

    summary = storage.list_workflows()[0]

    assert summary.last_run_status == "running"

    storage.close()


def test_run_lifecycle_sets_timestamps():
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = storage.save_workflow(workflow_document())

    run = storage.create_run(workflow)
    assert run.status == "queued"
    assert run.workflow_id == "workflow_1"
    assert run.workflow_version == 1

    storage.update_run(run.id, status="running")
    running = storage.get_run(run.id)
    assert running is not None
    assert running.status == "running"
    assert running.started_at is not None
    assert running.completed_at is None

    storage.update_run(run.id, status="succeeded")
    succeeded = storage.get_run(run.id)
    assert succeeded is not None
    assert succeeded.status == "succeeded"
    assert succeeded.completed_at is not None

    storage.close()


def test_run_lineage_round_trips_through_storage():
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = storage.save_workflow(workflow_document())

    run = storage.create_run(
        workflow,
        parent_run_id="run_parent",
        parent_node_id="call_child",
    )
    stored = storage.get_run(run.id)

    assert stored is not None
    assert stored.parent_run_id == "run_parent"
    assert stored.parent_node_id == "call_child"


def test_run_lineage_requires_both_parent_fields():
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = storage.save_workflow(workflow_document())

    with pytest.raises(ValueError, match="Run lineage requires both"):
        storage.create_run(workflow, parent_run_id="run_parent")


def test_list_workflow_runs_returns_latest_runs_for_workflow_only():
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = storage.save_workflow(workflow_document())
    other_workflow = storage.save_workflow(
        WorkflowDocument(id="workflow_2", name="Other Workflow", nodes=[], edges=[])
    )

    oldest = storage.create_run(workflow)
    storage.update_run(oldest.id, status="failed", error="old failure")
    other_run = storage.create_run(other_workflow)
    storage.update_run(other_run.id, status="succeeded")
    newest = storage.create_run(workflow)
    storage.update_run(newest.id, status="succeeded")

    runs = storage.list_workflow_runs("workflow_1", limit=1)

    assert [run.id for run in runs] == [newest.id]
    assert runs[0].status == "succeeded"

    all_runs = storage.list_workflow_runs("workflow_1", limit=10)

    assert [run.id for run in all_runs] == [newest.id, oldest.id]

    storage.close()


def test_list_workflow_runs_can_continue_from_an_offset_without_leaking_other_workflows():
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = storage.save_workflow(workflow_document())
    other_workflow = storage.save_workflow(
        WorkflowDocument(id="workflow_other", name="Other Workflow", nodes=[], edges=[])
    )

    first = storage.create_run(workflow)
    second = storage.create_run(workflow)
    third = storage.create_run(workflow)
    storage.create_run(other_workflow)

    first_page = storage.list_workflow_runs(workflow.id, limit=2)
    second_page = storage.list_workflow_runs(workflow.id, limit=2, offset=2)

    assert [run.id for run in first_page] == [third.id, second.id]
    assert [run.id for run in second_page] == [first.id]
    storage.close()


def test_list_workflow_runs_can_filter_by_status_before_paging():
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = storage.save_workflow(workflow_document())
    succeeded = storage.create_run(workflow)
    storage.update_run(succeeded.id, status="succeeded")
    failed_old = storage.create_run(workflow)
    storage.update_run(failed_old.id, status="failed", error="old")
    failed_new = storage.create_run(workflow)
    storage.update_run(failed_new.id, status="failed", error="new")

    failed_runs = storage.list_workflow_runs(workflow.id, limit=1, status="failed")
    remaining_failed_runs = storage.list_workflow_runs(workflow.id, limit=1, offset=1, status="failed")

    assert [run.id for run in failed_runs] == [failed_new.id]
    assert [run.id for run in remaining_failed_runs] == [failed_old.id]
    storage.close()


def test_run_events_round_trip_scope_and_json_mode_payload():
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = storage.save_workflow(workflow_document())
    run = storage.create_run(workflow)
    occurred_at = datetime(2026, 6, 16, 12, 30, tzinfo=timezone.utc)

    storage.append_event(
        RunEvent(
            run_id=run.id,
            type="node.completed",
            timestamp="2026-06-16T12:30:00+00:00",
            node_id="node_2",
            scope=["node_1", "success"],
            payload={"response": {"status": 200}, "occurred_at": occurred_at},
        )
    )

    events = storage.list_events(run.id)

    assert len(events) == 1
    assert events[0].id == 1
    assert events[0].run_id == run.id
    assert events[0].node_id == "node_2"
    assert events[0].scope == ["node_1", "success"]
    assert events[0].payload == {
        "response": {"status": 200},
        "occurred_at": "2026-06-16T12:30:00Z",
    }

    storage.close()


def test_storage_enforces_run_event_foreign_key():
    storage = Storage(":memory:")
    storage.init_schema()

    with pytest.raises(sqlite3.IntegrityError):
        storage.append_event(
            RunEvent(run_id="missing", type="node_started", timestamp=utc_now())
        )

    storage.close()


def test_storage_enforces_run_workflow_version_foreign_key():
    storage = Storage(":memory:")
    storage.init_schema()

    with pytest.raises(sqlite3.IntegrityError):
        with storage._connection:
            storage._connection.execute(
                """
                INSERT INTO runs (id, workflow_id, workflow_version, status, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                ("run_bad", "missing", 99, "queued", utc_now()),
            )

    storage.close()
