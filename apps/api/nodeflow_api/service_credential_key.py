"""Portable service keys, kept separate from credential ciphertext and workflows."""

from __future__ import annotations

import base64
import os
import stat
import tempfile
from pathlib import Path

from .credentials import CredentialStorageUnavailableError


class ServiceCredentialKey:
    def __init__(self) -> None:
        self._configured_key = os.environ.get("NODE_FLOW_CREDENTIAL_KEY")
        configured_file = os.environ.get("NODE_FLOW_CREDENTIAL_KEY_FILE")
        if self._configured_key is not None and configured_file is not None:
            raise CredentialStorageUnavailableError(
                "Configure only NODE_FLOW_CREDENTIAL_KEY or NODE_FLOW_CREDENTIAL_KEY_FILE"
            )
        if configured_file is not None and not configured_file.strip():
            raise CredentialStorageUnavailableError("NODE_FLOW_CREDENTIAL_KEY_FILE is empty")
        self.path: Path | None = None
        if self._configured_key is None:
            self.path = (
                Path(configured_file).expanduser().absolute() if configured_file is not None
                else Path.home() / ".node-flow" / "credential.key"
            )

    @staticmethod
    def _decode(value: str | bytes) -> bytes:
        try:
            key = base64.b64decode(value.strip(), validate=True)
        except (ValueError, UnicodeError):
            raise CredentialStorageUnavailableError(
                "Service credential key must be base64 encoding of exactly 32 bytes"
            ) from None
        if len(key) != 32:
            raise CredentialStorageUnavailableError(
                "Service credential key must be base64 encoding of exactly 32 bytes"
            )
        return key

    def _read(self) -> bytes | None:
        assert self.path is not None
        # Reject symlinks and special files; never replace an invalid existing key.
        if self.path.is_symlink():
            raise CredentialStorageUnavailableError("Service credential key file must not be a symlink")
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        try:
            handle = os.open(self.path, flags)
        except FileNotFoundError:
            return None
        with os.fdopen(handle, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode):
                raise CredentialStorageUnavailableError("Service credential key file must be a regular file")
            if os.name != "nt" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
                raise CredentialStorageUnavailableError(
                    "Service credential key file must be owned by the service user with mode 600"
                )
            if info.st_size > 1024:
                raise CredentialStorageUnavailableError("Service credential key file is invalid")
            return self._decode(stream.read(1025))

    def key(self, *, create: bool) -> bytes:
        if self._configured_key is not None:
            return self._decode(self._configured_key)
        assert self.path is not None
        try:
            existing = self._read()
            if existing is not None:
                return existing
            if not create:
                raise CredentialStorageUnavailableError("Service credential key file is missing")
            self.path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
            candidate = os.urandom(32)
            handle, temporary = tempfile.mkstemp(prefix=".credential-key-", dir=self.path.parent)
            try:
                with os.fdopen(handle, "wb") as stream:
                    stream.write(base64.b64encode(candidate) + b"\n")
                    stream.flush()
                    os.fsync(stream.fileno())
                try:
                    # Publish a complete file atomically without replacing a winner.
                    os.link(temporary, self.path)
                except FileExistsError:
                    pass
                existing = self._read()
                if existing is None:
                    raise CredentialStorageUnavailableError("Service credential key file is missing")
                return existing
            finally:
                os.unlink(temporary)
        except OSError:
            raise CredentialStorageUnavailableError(
                "Service credential key file is unavailable; check path and file permissions"
            ) from None
