from datetime import datetime, timezone

from apps.api.nodeflow_api.webhook_test_listeners import WebhookTestListenerRegistry


def test_listener_is_consumed_once_and_expires():
    clock = [10.0]
    registry = WebhookTestListenerRegistry(
        clock=lambda: clock[0],
        now=lambda: datetime(2026, 7, 23, tzinfo=timezone.utc),
    )

    listener = registry.arm("wf_1", "webhook", ttl_seconds=5)

    assert listener.expires_at.isoformat() == "2026-07-23T00:00:05+00:00"
    assert registry.status("wf_1", "webhook") == listener
    assert registry.consume("wf_1", "webhook") is True
    assert registry.status("wf_1", "webhook") is None
    assert registry.consume("wf_1", "webhook") is False

    registry.arm("wf_1", "webhook", ttl_seconds=5)
    clock[0] = 15.0
    assert registry.status("wf_1", "webhook") is None
    assert registry.consume("wf_1", "webhook") is False
