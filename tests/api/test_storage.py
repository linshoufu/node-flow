from datetime import datetime, timezone

from apps.api.nodeflow_api.schemas import (
    Position,
    RunEvent,
    WorkflowDocument,
    WorkflowEdge,
    WorkflowNode,
    WorkflowSubflow,
)
from apps.api.nodeflow_api.storage import Storage


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
    assert first.nodes[0].subflows["success"].nodes[0].config == {"url": "https://example.com"}
    assert first.edges[0].sourceHandle == "success"
    assert storage.list_workflows()[0].model_dump() == {
        "id": "workflow_1",
        "name": "Renamed Workflow",
        "version": 2,
    }

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
