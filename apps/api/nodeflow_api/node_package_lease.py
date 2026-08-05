from __future__ import annotations

import errno
import json
import os
import socket
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

if os.name == "nt":
    import msvcrt
else:
    import fcntl


class NodePackageLeaseBusyError(Exception):
    def __init__(self, owner: dict[str, object] | None = None) -> None:
        super().__init__("node package mutation lease is busy")
        self.owner = owner


class NodePackageMutationLease:
    """Serialize package filesystem mutations across API and worker processes."""

    def __init__(self, path: Path, *, timeout_seconds: float = 2.0) -> None:
        self.path = path.resolve()
        self.owner_path = self.path.with_name(f"{self.path.name}.owner.json")
        self.timeout_seconds = timeout_seconds

    @contextmanager
    def acquire(
        self,
        owner: dict[str, object],
        *,
        timeout_seconds: float | None = None,
    ) -> Iterator[None]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        handle = os.fdopen(descriptor, "r+b", buffering=0)
        timeout = self.timeout_seconds if timeout_seconds is None else timeout_seconds
        deadline = time.monotonic() + max(timeout, 0.0)
        acquired = False
        try:
            self._ensure_lock_byte(handle)
            while True:
                try:
                    self._try_lock(handle)
                    acquired = True
                    break
                except OSError as exc:
                    if not self._is_lock_contention(exc):
                        raise
                    if time.monotonic() >= deadline:
                        raise NodePackageLeaseBusyError(self.read_owner()) from exc
                    time.sleep(0.05)

            lease_owner = {
                **owner,
                "pid": os.getpid(),
                "hostname": socket.gethostname(),
                "acquiredAt": datetime.now(timezone.utc).isoformat(),
            }
            self._write_owner(lease_owner)
            yield
        finally:
            if acquired:
                self.owner_path.unlink(missing_ok=True)
                self._unlock(handle)
            handle.close()

    def read_owner(self) -> dict[str, object] | None:
        try:
            raw = json.loads(self.owner_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return raw if isinstance(raw, dict) else None

    def _write_owner(self, owner: dict[str, object]) -> None:
        temporary = self.owner_path.with_name(
            f".{self.owner_path.name}.{os.getpid()}.{time.time_ns()}.tmp"
        )
        try:
            temporary.write_text(
                json.dumps(owner, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            os.replace(temporary, self.owner_path)
        finally:
            temporary.unlink(missing_ok=True)

    @staticmethod
    def _ensure_lock_byte(handle) -> None:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"\0")
            handle.flush()

    @staticmethod
    def _try_lock(handle) -> None:
        handle.seek(0)
        if os.name == "nt":
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

    @staticmethod
    def _unlock(handle) -> None:
        handle.seek(0)
        if os.name == "nt":
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    @staticmethod
    def _is_lock_contention(exc: OSError) -> bool:
        return exc.errno in {errno.EACCES, errno.EAGAIN, errno.EDEADLK}
