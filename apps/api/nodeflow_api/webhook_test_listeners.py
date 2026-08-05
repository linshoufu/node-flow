from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from time import monotonic


@dataclass(frozen=True)
class WebhookTestListener:
    workflow_id: str
    node_id: str
    expires_at: datetime


@dataclass(frozen=True)
class _ListenerEntry:
    listener: WebhookTestListener
    expires_at_monotonic: float


class WebhookTestListenerRegistry:
    """In-memory, one-shot listeners for editor-initiated webhook tests."""

    def __init__(self, *, clock=monotonic, now=None) -> None:
        self._clock = clock
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._entries: dict[tuple[str, str], _ListenerEntry] = {}
        self._lock = Lock()

    def arm(self, workflow_id: str, node_id: str, *, ttl_seconds: int = 120) -> WebhookTestListener:
        if ttl_seconds < 1:
            raise ValueError("ttl_seconds must be positive")
        expires_at = self._now() + timedelta(seconds=ttl_seconds)
        listener = WebhookTestListener(workflow_id=workflow_id, node_id=node_id, expires_at=expires_at)
        with self._lock:
            self._entries[(workflow_id, node_id)] = _ListenerEntry(
                listener=listener,
                expires_at_monotonic=self._clock() + ttl_seconds,
            )
        return listener

    def consume(self, workflow_id: str, node_id: str) -> bool:
        key = (workflow_id, node_id)
        with self._lock:
            entry = self._active_entry(key)
            if entry is None:
                return False
            del self._entries[key]
            return True

    def status(self, workflow_id: str, node_id: str) -> WebhookTestListener | None:
        with self._lock:
            entry = self._active_entry((workflow_id, node_id))
            return entry.listener if entry else None

    def disarm(self, workflow_id: str, node_id: str) -> bool:
        with self._lock:
            return self._entries.pop((workflow_id, node_id), None) is not None

    def disarm_workflow(self, workflow_id: str) -> None:
        with self._lock:
            for key in [key for key in self._entries if key[0] == workflow_id]:
                self._entries.pop(key, None)

    def _active_entry(self, key: tuple[str, str]) -> _ListenerEntry | None:
        entry = self._entries.get(key)
        if entry and entry.expires_at_monotonic <= self._clock():
            del self._entries[key]
            return None
        return entry
