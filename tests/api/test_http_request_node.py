import pytest

from nodeflow_sdk import NodeContext
from nodes.builtin.http_request import HttpRequestNode


class _Response:
    is_error = False
    status_code = 200
    headers: dict[str, str] = {}

    def json(self) -> dict[str, bool]:
        return {"ok": True}


class _RecordingAsyncClient:
    init_kwargs: dict[str, object] = {}

    def __init__(self, **kwargs: object) -> None:
        type(self).init_kwargs = kwargs

    async def __aenter__(self) -> "_RecordingAsyncClient":
        return self

    async def __aexit__(self, exc_type: object, exc: object, traceback: object) -> None:
        return None

    async def request(self, *_args: object, **_kwargs: object) -> _Response:
        return _Response()


@pytest.mark.asyncio
async def test_http_request_ignores_ambient_proxy_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("nodes.builtin.http_request.httpx.AsyncClient", _RecordingAsyncClient)
    node = HttpRequestNode(config={"url": "http://127.0.0.1:8150/api/health"})

    result = await node.execute(NodeContext(run_id="run_1", node_id="request"), {})

    assert result["success"]["status_code"] == 200
    assert _RecordingAsyncClient.init_kwargs["trust_env"] is False
