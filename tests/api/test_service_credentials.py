from __future__ import annotations

import base64
import os
import stat
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from apps.api.nodeflow_api.credentials import CredentialStorageUnavailableError, CredentialVault
from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.service_credential_key import ServiceCredentialKey


def use_key_file(monkeypatch, path):
    monkeypatch.delenv("NODE_FLOW_CREDENTIAL_KEY", raising=False)
    monkeypatch.setenv("NODE_FLOW_CREDENTIAL_KEY_FILE", str(path))


def test_service_ciphertext_round_trips_across_process_instances():
    data = {"username": "测试用户", "password": "test-password"}
    vault = CredentialVault()
    first, second = vault.encrypt(data), vault.encrypt(data)
    assert first != second
    assert b"test-password" not in base64.b64decode(first)
    assert CredentialVault().decrypt(first) == data
    assert CredentialVault().decrypt(second) == data


def test_environment_key_needs_no_home_directory_or_key_file(monkeypatch):
    def forbidden(cls):
        raise AssertionError("Environment keys must not need a home directory")

    monkeypatch.setattr(Path, "home", classmethod(forbidden))
    vault = CredentialVault()
    assert vault.decrypt(vault.encrypt({"token": "dummy-secret"})) == {"token": "dummy-secret"}


def test_service_ciphertext_rejects_wrong_key_and_tampering(monkeypatch):
    original = CredentialVault()
    encrypted = original.encrypt({"token": "secret"})
    raw = bytearray(base64.b64decode(encrypted))
    raw[-1] ^= 1
    with pytest.raises(ValueError, match="ciphertext is invalid"):
        original.decrypt(base64.b64encode(raw).decode())
    monkeypatch.setenv("NODE_FLOW_CREDENTIAL_KEY", base64.b64encode(os.urandom(32)).decode())
    with pytest.raises(ValueError, match="ciphertext is invalid"):
        CredentialVault().decrypt(encrypted)


@pytest.mark.parametrize("raw", [b"NodeFlowService\x00\x01", b"NodeFlowService\x00\x02bad", b"unsupported-ciphertext"])
def test_service_envelope_validation_precedes_key_access(monkeypatch, raw):
    monkeypatch.setenv("NODE_FLOW_CREDENTIAL_KEY", "invalid-configured-key")
    with pytest.raises(ValueError, match="ciphertext is invalid"):
        CredentialVault().decrypt(base64.b64encode(raw).decode())


@pytest.mark.parametrize("value", ["", "bad-base64", "非 ASCII", base64.b64encode(b"x" * 31).decode()])
def test_invalid_configured_keys_fail_without_exposing_input(monkeypatch, value):
    monkeypatch.setenv("NODE_FLOW_CREDENTIAL_KEY", value)
    with pytest.raises(CredentialStorageUnavailableError) as error:
        CredentialVault().encrypt({"token": "secret"})
    assert "exactly 32 bytes" in str(error.value)
    if value:
        assert value not in str(error.value)


def test_conflicting_key_sources_are_rejected(monkeypatch, tmp_path):
    monkeypatch.setenv("NODE_FLOW_CREDENTIAL_KEY_FILE", str(tmp_path / "key"))
    with pytest.raises(CredentialStorageUnavailableError, match="Configure only"):
        CredentialVault().encrypt({"token": "secret"})
    assert not (tmp_path / "key").exists()


def test_default_local_key_file_is_created_once_and_reused(monkeypatch, tmp_path):
    monkeypatch.delenv("NODE_FLOW_CREDENTIAL_KEY", raising=False)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    vault = CredentialVault()
    encrypted = vault.encrypt({"token": "dummy-secret"})
    path = tmp_path / ".node-flow" / "credential.key"
    original_key = path.read_bytes()
    assert len(base64.b64decode(original_key)) == 32
    assert CredentialVault().decrypt(encrypted) == {"token": "dummy-secret"}
    assert path.read_bytes() == original_key
    if os.name != "nt":
        assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_missing_key_on_decrypt_is_not_created(monkeypatch, tmp_path):
    encrypted = CredentialVault().encrypt({"token": "secret"})
    path = tmp_path / "missing" / "key"
    use_key_file(monkeypatch, path)
    with pytest.raises(CredentialStorageUnavailableError, match="key file is missing"):
        CredentialVault().decrypt(encrypted)
    assert not path.parent.exists()


def test_corrupt_key_file_is_not_replaced(monkeypatch, tmp_path):
    path = tmp_path / "key"
    path.write_bytes(b"corrupt")
    path.chmod(0o600)
    use_key_file(monkeypatch, path)
    with pytest.raises(CredentialStorageUnavailableError, match="exactly 32 bytes"):
        CredentialVault().encrypt({"token": "secret"})
    assert path.read_bytes() == b"corrupt"


@pytest.mark.skipif(os.name == "nt", reason="POSIX file permissions")
def test_readable_by_other_users_key_file_is_rejected(monkeypatch, tmp_path):
    path = tmp_path / "key"
    path.write_bytes(base64.b64encode(os.urandom(32)))
    path.chmod(0o644)
    use_key_file(monkeypatch, path)
    with pytest.raises(CredentialStorageUnavailableError, match="mode 600"):
        ServiceCredentialKey().key(create=True)


def test_api_key_failure_preserves_existing_credential(monkeypatch, tmp_path):
    path = tmp_path / "key"
    use_key_file(monkeypatch, path)
    app = create_app(database_path=":memory:")
    with TestClient(app) as client:
        created = client.post("/api/credentials", json={
            "type_id": "http.bearer", "name": "original", "data": {"token": "original-secret"},
        })
        assert created.status_code == 201
        credential_id = created.json()["id"]
        original = app.state.storage.get_credential(credential_id).encrypted_data
        path.write_bytes(b"invalid-key")
        failed = client.patch(f"/api/credentials/{credential_id}", json={
            "name": "changed", "data": {"token": "replacement-secret"},
        })
        assert failed.status_code == 503
        assert "replacement-secret" not in failed.text
        stored = app.state.storage.get_credential(credential_id)
        assert stored.name == "original"
        assert stored.encrypted_data == original


def test_multiple_processes_create_one_complete_key_file(monkeypatch, tmp_path):
    path = tmp_path / "shared" / "key"
    use_key_file(monkeypatch, path)
    script = (
        "from apps.api.nodeflow_api.credentials import CredentialVault; "
        "print(CredentialVault().encrypt({'token': 'process-test-secret'}))"
    )

    def encrypt_in_process(_):
        result = subprocess.run(
            [sys.executable, "-c", script], capture_output=True, text=True, check=True, timeout=20,
        )
        return result.stdout.strip()

    with ThreadPoolExecutor(max_workers=4) as pool:
        ciphertexts = list(pool.map(encrypt_in_process, range(4)))
    vault = CredentialVault()
    assert len(set(ciphertexts)) == 4
    assert all(vault.decrypt(value) == {"token": "process-test-secret"} for value in ciphertexts)
    assert list(path.parent.iterdir()) == [path]
