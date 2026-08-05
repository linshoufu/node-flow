from __future__ import annotations

import pytest

from apps.api.nodeflow_api.credentials import (
    CredentialStorageUnavailableError,
    CredentialVault,
    credential_type_by_id,
    list_credential_types,
)
from apps.api.nodeflow_api.storage import Storage


def test_windows_credential_vault_encrypts_and_round_trips_secret_data():
    vault = CredentialVault(platform="win32")

    encrypted_data = vault.encrypt({"token": "secret-token-value"})

    assert "secret-token-value" not in encrypted_data
    assert vault.decrypt(encrypted_data) == {"token": "secret-token-value"}


def test_credential_vault_never_falls_back_to_plaintext_outside_windows():
    vault = CredentialVault(platform="linux")

    with pytest.raises(CredentialStorageUnavailableError, match="Windows DPAPI"):
        vault.encrypt({"token": "secret-token-value"})


def test_credential_type_registry_exposes_supported_http_types_and_required_fields():
    credential_types = list_credential_types()

    assert [credential_type.id for credential_type in credential_types] == [
        "http.bearer",
        "http.basic",
        "http.header",
        "webhook.hmac_sha256",
    ]
    assert credential_type_by_id("http.basic").fields == ("username", "password")
    assert credential_type_by_id("missing") is None


def test_storage_persists_credential_ciphertext_but_lists_only_safe_summary():
    storage = Storage(":memory:")
    storage.init_schema()
    vault = CredentialVault(platform="win32")
    encrypted_data = vault.encrypt({"token": "secret-token-value"})

    created = storage.create_credential(
        type_id="http.bearer",
        name="测试接口令牌",
        encrypted_data=encrypted_data,
    )

    raw = storage._connection.execute(
        "SELECT encrypted_data FROM credentials WHERE id = ?", (created.id,)
    ).fetchone()
    summaries = storage.list_credentials()

    assert created.id.startswith("cred_")
    assert raw is not None
    assert "secret-token-value" not in raw["encrypted_data"]
    assert summaries[0].model_dump() == {
        "id": created.id,
        "type_id": "http.bearer",
        "name": "测试接口令牌",
        "created_at": created.created_at,
        "updated_at": created.updated_at,
    }
    assert not hasattr(summaries[0], "encrypted_data")
    assert storage.get_credential(created.id) == created
