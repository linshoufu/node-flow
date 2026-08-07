"""运行事件增量查询与 SSE 事件流测试。"""

import json
import threading
import time

from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.schemas import (
    Position,
    RunEvent,
    WorkflowDocument,
    WorkflowNode,
)
from apps.api.nodeflow_api.storage import Storage, utc_now


def make_storage() -> Storage:
    storage = Storage(":memory:")
    storage.init_schema()
    return storage


def make_workflow(workflow_id: str) -> WorkflowDocument:
    return WorkflowDocument(
        id=workflow_id,
        name="Stream Workflow",
        nodes=[
            WorkflowNode(
                id="log",
                type="utility.log",
                position=Position(x=0, y=0),
                config={"message": "hello"},
            )
        ],
        edges=[],
    )


def create_run_in_storage(storage: Storage, workflow_id: str):
    saved = storage.save_workflow(make_workflow(workflow_id))
    return storage.create_run(saved)


def append_event(storage: Storage, run_id: str, event_type: str) -> int:
    storage.append_event(RunEvent(run_id=run_id, type=event_type, timestamp=utc_now()))
    return storage.list_events(run_id)[-1].id


def parse_sse_frames(text: str) -> list[dict]:
    """解析 SSE 文本为帧列表，每帧含 id 与 data 字段。"""
    frames = []
    for raw_frame in text.split("\n\n"):
        if not raw_frame.strip():
            continue
        frame: dict = {}
        for line in raw_frame.splitlines():
            if line.startswith("id: "):
                frame["id"] = int(line[4:])
            elif line.startswith("data: "):
                frame["data"] = json.loads(line[6:])
            elif line.startswith(":"):
                frame.setdefault("comments", []).append(line)
        if frame:
            frames.append(frame)
    return frames


def test_list_events_without_params_returns_all_events():
    storage = make_storage()
    run = create_run_in_storage(storage, "wf_events_default")
    first_id = append_event(storage, run.id, "node_started")
    second_id = append_event(storage, run.id, "node_succeeded")

    events = storage.list_events(run.id)

    assert [event.id for event in events] == [first_id, second_id]
    assert [event.type for event in events] == ["node_started", "node_succeeded"]


def test_list_events_after_id_returns_only_newer_events():
    storage = make_storage()
    run = create_run_in_storage(storage, "wf_events_after_id")
    first_id = append_event(storage, run.id, "node_started")
    second_id = append_event(storage, run.id, "node_succeeded")
    third_id = append_event(storage, run.id, "run_succeeded")

    events = storage.list_events(run.id, after_id=first_id)

    assert [event.id for event in events] == [second_id, third_id]


def test_list_events_limit_returns_first_n_events():
    storage = make_storage()
    run = create_run_in_storage(storage, "wf_events_limit")
    first_id = append_event(storage, run.id, "node_started")
    append_event(storage, run.id, "node_succeeded")
    append_event(storage, run.id, "run_succeeded")

    events = storage.list_events(run.id, limit=1)

    assert [event.id for event in events] == [first_id]


def test_list_events_after_id_and_limit_combine():
    storage = make_storage()
    run = create_run_in_storage(storage, "wf_events_cursor_limit")
    first_id = append_event(storage, run.id, "node_started")
    second_id = append_event(storage, run.id, "node_succeeded")
    append_event(storage, run.id, "run_succeeded")

    events = storage.list_events(run.id, after_id=first_id, limit=1)

    assert [event.id for event in events] == [second_id]


def test_events_endpoint_supports_after_id_and_limit_params():
    app = create_app(database_path=":memory:", execution_mode="worker")
    client = TestClient(app)
    run = create_run_in_storage(app.state.storage, "wf_events_query_params")
    first_id = append_event(app.state.storage, run.id, "node_started")
    second_id = append_event(app.state.storage, run.id, "node_succeeded")
    append_event(app.state.storage, run.id, "run_succeeded")

    response = client.get(f"/api/runs/{run.id}/events?after_id={first_id}&limit=1")

    assert response.status_code == 200
    events = response.json()
    assert [event["id"] for event in events] == [second_id]


def test_events_endpoint_returns_404_for_unknown_run():
    client = TestClient(create_app(database_path=":memory:", execution_mode="worker"))

    response = client.get("/api/runs/run_missing/events?after_id=1&limit=5")

    assert response.status_code == 404


def test_events_stream_returns_404_for_unknown_run():
    client = TestClient(create_app(database_path=":memory:", execution_mode="worker"))

    with client.stream("GET", "/api/runs/run_missing/events/stream") as response:
        assert response.status_code == 404


def test_events_stream_replays_existing_events_and_closes_on_terminal_status():
    app = create_app(database_path=":memory:", execution_mode="worker")
    client = TestClient(app)
    run = create_run_in_storage(app.state.storage, "wf_stream_replay")
    first_id = append_event(app.state.storage, run.id, "node_started")
    second_id = append_event(app.state.storage, run.id, "node_succeeded")
    app.state.storage.update_run(run.id, status="succeeded")

    with client.stream("GET", f"/api/runs/{run.id}/events/stream") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        text = "".join(response.iter_text())

    frames = parse_sse_frames(text)
    assert [frame["id"] for frame in frames] == [first_id, second_id]
    assert [frame["data"]["type"] for frame in frames] == ["node_started", "node_succeeded"]
    assert all(frame["data"]["run_id"] == run.id for frame in frames)


def test_events_stream_pushes_incremental_events_until_terminal_status():
    app = create_app(database_path=":memory:", execution_mode="worker")
    client = TestClient(app)
    storage = app.state.storage
    run = create_run_in_storage(storage, "wf_stream_incremental")
    replayed_id = append_event(storage, run.id, "node_started")
    storage.update_run(run.id, status="running")

    def worker_like_writer():
        # 模拟独立 worker 进程：流打开后继续写事件，最后置为终态
        time.sleep(0.6)
        append_event(storage, run.id, "node_succeeded")
        time.sleep(0.6)
        append_event(storage, run.id, "run_succeeded")
        storage.update_run(run.id, status="succeeded")

    writer = threading.Thread(target=worker_like_writer)
    writer.start()
    try:
        with client.stream("GET", f"/api/runs/{run.id}/events/stream") as response:
            assert response.status_code == 200
            text = "".join(response.iter_text())
    finally:
        writer.join()

    frames = parse_sse_frames(text)
    assert [frame["data"]["type"] for frame in frames] == [
        "node_started",
        "node_succeeded",
        "run_succeeded",
    ]
    assert frames[0]["id"] == replayed_id
    # id 游标严格递增，证明增量帧来自 after_id tail
    assert all(earlier["id"] < later["id"] for earlier, later in zip(frames, frames[1:]))
