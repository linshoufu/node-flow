from __future__ import annotations

import base64
import os

import pytest


@pytest.fixture(autouse=True)
def isolated_credential_key(monkeypatch):
    """Use real portable encryption with an isolated key, never user key files.

    Each test gets its own environment key; subprocesses inherit it naturally.
    """
    monkeypatch.setenv("NODE_FLOW_CREDENTIAL_KEY", base64.b64encode(os.urandom(32)).decode())
    monkeypatch.delenv("NODE_FLOW_CREDENTIAL_KEY_FILE", raising=False)
