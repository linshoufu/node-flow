import json
from pathlib import Path

import httpx
import pytest

from apps.api.nodeflow_api.executor import WorkflowExecutor
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowEdge, WorkflowNode, WorkflowSubflow
from apps.api.nodeflow_api.storage import Storage


def make_registry() -> NodeRegistry:
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    return registry


def position(x: float = 0, y: float = 0) -> Position:
    return Position(x=x, y=y)


async def execute_workflow(workflow: WorkflowDocument):
    storage = Storage(":memory:")
    storage.init_schema()
    saved = storage.save_workflow(workflow)
    run = storage.create_run(saved)
    executor = WorkflowExecutor(storage=storage, registry=make_registry())

    await executor.execute(run.id, saved)

    return storage, run


@pytest.mark.asyncio
async def test_csv_driven_api_workflow_records_assertions_and_writes_report(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    csv_path = tmp_path / "users.csv"
    csv_path.write_text("name,age\nAlice,20\nBob,30\n", encoding="utf-8")
    report_path = tmp_path / "report.json"
    seen_request_bodies: list[dict] = []

    async def fake_request(self, method, url, *, headers, json):
        request = httpx.Request(method, url)
        seen_request_bodies.append(json)
        return httpx.Response(
            200,
            json={"created": True, "name": json["name"], "age": json["age"]},
            request=request,
        )

    monkeypatch.setattr(httpx.AsyncClient, "request", fake_request)

    workflow = WorkflowDocument(
        id="wf_csv_api",
        name="CSV API",
        nodes=[
            WorkflowNode(
                id="csv",
                type="data.csv_read",
                position=position(),
                config={"path": str(csv_path)},
            ),
            WorkflowNode(
                id="each",
                type="control.foreach",
                position=position(200, 0),
                config={"items_expression": "{{ inputs.input.rows }}"},
                subflows={
                    "body": WorkflowSubflow(
                        nodes=[
                            WorkflowNode(
                                id="row",
                                type="utility.transform",
                                position=position(),
                                config={"value": "{{ loop.item }}"},
                            ),
                            WorkflowNode(
                                id="request",
                                type="http.request",
                                position=position(200, 0),
                                config={"method": "POST", "url": "https://api.test/users"},
                            ),
                            WorkflowNode(
                                id="assert_status",
                                type="assert.status_code",
                                position=position(400, 0),
                                config={"expected": 200},
                            ),
                            WorkflowNode(
                                id="record",
                                type="test.record_result",
                                position=position(600, 0),
                                config={"name": "create user"},
                            ),
                        ],
                        edges=[
                            WorkflowEdge(
                                id="body_e1",
                                source="row",
                                sourceHandle="success",
                                target="request",
                                targetHandle="body",
                            ),
                            WorkflowEdge(
                                id="body_e2",
                                source="request",
                                sourceHandle="success",
                                target="assert_status",
                                targetHandle="input",
                            ),
                            WorkflowEdge(
                                id="body_e3",
                                source="assert_status",
                                sourceHandle="passed",
                                target="record",
                                targetHandle="input",
                            ),
                            WorkflowEdge(
                                id="body_e4",
                                source="assert_status",
                                sourceHandle="failed",
                                target="record",
                                targetHandle="input",
                            ),
                        ],
                    )
                },
            ),
            WorkflowNode(id="summary", type="test.summary", position=position(400, 0)),
            WorkflowNode(
                id="report",
                type="test.write_report",
                position=position(600, 0),
                config={"path": str(report_path)},
            ),
        ],
        edges=[
            WorkflowEdge(
                id="e1",
                source="csv",
                sourceHandle="success",
                target="each",
                targetHandle="input",
            ),
            WorkflowEdge(
                id="e2",
                source="each",
                sourceHandle="done",
                target="summary",
                targetHandle="input",
            ),
            WorkflowEdge(
                id="e3",
                source="summary",
                sourceHandle="success",
                target="report",
                targetHandle="input",
            ),
        ],
    )

    storage, run = await execute_workflow(workflow)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    assert seen_request_bodies == [{"name": "Alice", "age": "20"}, {"name": "Bob", "age": "30"}]

    csv_event = next(event for event in events if event.node_id == "csv" and event.type == "node_succeeded")
    assert csv_event.payload["outputs"]["success"]["headers"] == ["name", "age"]
    assert csv_event.payload["outputs"]["success"]["columns"] == {
        "name": ["Alice", "Bob"],
        "age": ["20", "30"],
    }

    summary_event = next(
        event for event in events if event.node_id == "summary" and event.type == "node_succeeded"
    )
    assert summary_event.payload["outputs"]["success"]["summary"] == {
        "total": 2,
        "passed": 2,
        "failed": 0,
    }
    first_request_event = next(
        event
        for event in events
        if event.node_id == "request"
        and event.type == "node_succeeded"
        and event.scope == ["each", "iteration:0"]
    )
    assert isinstance(first_request_event.payload["duration_ms"], int | float)
    assert first_request_event.payload["duration_ms"] >= 0

    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["summary"] == {"total": 2, "passed": 2, "failed": 0}
    assert [item["row"]["name"] for item in report["results"]] == ["Alice", "Bob"]
    assert all(item["status"] == "passed" for item in report["results"])


@pytest.mark.asyncio
async def test_csv_item_output_drives_the_item_loop_body(tmp_path: Path):
    csv_path = tmp_path / "users.csv"
    csv_path.write_text("name\nAlice\nBob\n", encoding="utf-8")
    workflow = WorkflowDocument(
        id="wf_csv_items",
        name="CSV item loop",
        nodes=[
            WorkflowNode(
                id="csv",
                type="data.csv_read",
                position=position(),
                config={"path": str(csv_path)},
            ),
            WorkflowNode(
                id="each_item",
                type="control.each_item",
                position=position(240, 0),
                config={"max_items": 100, "continue_on_error": False, "timeout_seconds": 300},
                subflows={
                    "body": WorkflowSubflow(
                        nodes=[
                            WorkflowNode(
                                id="name",
                                type="utility.transform",
                                position=position(),
                                config={"value": "{{ loop.item.name }}"},
                            )
                        ],
                        edges=[],
                    )
                },
            ),
        ],
        edges=[
            WorkflowEdge(
                id="csv_each_item",
                source="csv",
                sourceHandle="items",
                target="each_item",
                targetHandle="items",
            )
        ],
    )

    storage, run = await execute_workflow(workflow)

    events = storage.list_events(run.id)
    csv_event = next(event for event in events if event.node_id == "csv" and event.type == "node_succeeded")
    loop_event = next(event for event in events if event.node_id == "each_item" and event.type == "node_started")
    body_values = [
        event.payload["outputs"]["success"]
        for event in events
        if event.node_id == "name" and event.type == "node_succeeded"
    ]

    assert storage.get_run(run.id).status == "succeeded"
    assert csv_event.payload["outputs"]["items"] == [
        {"json": {"name": "Alice"}, "pairedItem": {"item": 0}},
        {"json": {"name": "Bob"}, "pairedItem": {"item": 1}},
    ]
    assert loop_event.payload["inputs"]["items"] == csv_event.payload["outputs"]["items"]
    assert body_values == ["Alice", "Bob"]


@pytest.mark.asyncio
async def test_failed_assertion_can_be_recorded_and_fail_at_summary(tmp_path: Path):
    report_path = tmp_path / "failed-report.json"
    workflow = WorkflowDocument(
        id="wf_assert_fail",
        name="Assertion Failure",
        nodes=[
            WorkflowNode(
                id="start",
                type="manual.trigger",
                position=position(),
                config={"payload": {"status_code": 500, "body": {"message": "bad"}}},
            ),
            WorkflowNode(
                id="assert_status",
                type="assert.status_code",
                position=position(200, 0),
                config={"expected": 200},
            ),
            WorkflowNode(
                id="record",
                type="test.record_result",
                position=position(400, 0),
                config={"name": "status is 200"},
            ),
            WorkflowNode(
                id="summary",
                type="test.summary",
                position=position(600, 0),
                config={"fail_run_on_failed": True},
            ),
            WorkflowNode(
                id="report",
                type="test.write_report",
                position=position(800, 0),
                config={"path": str(report_path)},
            ),
        ],
        edges=[
            WorkflowEdge(
                id="e1",
                source="start",
                sourceHandle="success",
                target="assert_status",
                targetHandle="input",
            ),
            WorkflowEdge(
                id="e2",
                source="assert_status",
                sourceHandle="failed",
                target="record",
                targetHandle="input",
            ),
            WorkflowEdge(
                id="e3",
                source="record",
                sourceHandle="success",
                target="summary",
                targetHandle="input",
            ),
            WorkflowEdge(
                id="e4",
                source="summary",
                sourceHandle="failed",
                target="report",
                targetHandle="input",
            ),
        ],
    )

    storage, run = await execute_workflow(workflow)

    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded"
    summary_event = next(
        event for event in events if event.node_id == "summary" and event.type == "node_succeeded"
    )
    assert summary_event.payload["outputs"]["failed"]["summary"] == {
        "total": 1,
        "passed": 0,
        "failed": 1,
    }
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["summary"]["failed"] == 1
    assert report["results"][0]["message"] == "Expected status 200, got 500"
