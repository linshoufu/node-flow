from __future__ import annotations

import base64
import json
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

if TYPE_CHECKING:
    from .service_credential_key import ServiceCredentialKey

_SERVICE_CIPHERTEXT_HEADER = b"NodeFlowService\x00\x01"


_IDENTIFIER_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9._-]*")
_FIELD_IDENTIFIER_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


class CredentialStorageUnavailableError(RuntimeError):
    pass


@dataclass(frozen=True)
class CredentialField:
    id: str
    label: str
    secret: bool


@dataclass(frozen=True)
class CredentialType:
    id: str
    display_name: str
    field_definitions: tuple[CredentialField, ...]
    node_type_ids: tuple[str, ...]

    @property
    def fields(self) -> tuple[str, ...]:
        return tuple(field.id for field in self.field_definitions)


_CREDENTIAL_TYPES = (
    CredentialType(
        id="http.bearer",
        display_name="HTTP Bearer 令牌",
        field_definitions=(CredentialField("token", "令牌", True),),
        node_type_ids=("http.request",),
    ),
    CredentialType(
        id="http.basic",
        display_name="HTTP 基础认证",
        field_definitions=(
            CredentialField("username", "用户名", False),
            CredentialField("password", "密码", True),
        ),
        node_type_ids=("http.request",),
    ),
    CredentialType(
        id="http.header",
        display_name="HTTP 请求头",
        field_definitions=(
            CredentialField("name", "请求头名称", False),
            CredentialField("value", "请求头值", True),
        ),
        node_type_ids=("http.request", "webhook.trigger"),
    ),
    CredentialType(
        id="http.login",
        display_name="HTTP 登录账号",
        field_definitions=(
            CredentialField("tenant", "租户 / 组织代码", False),
            CredentialField("username", "用户名", False),
            CredentialField("password", "密码", True),
        ),
        node_type_ids=("http.request",),
    ),
    CredentialType(
        id="webhook.hmac_sha256",
        display_name="Webhook HMAC-SHA256 签名",
        field_definitions=(
            CredentialField("secret", "签名密钥", True),
            CredentialField("header_name", "签名请求头", False),
        ),
        node_type_ids=("webhook.trigger",),
    ),
)

def list_credential_types() -> tuple[CredentialType, ...]:
    return _CREDENTIAL_TYPES


def credential_type_by_id(type_id: str) -> CredentialType | None:
    return next((credential_type for credential_type in _CREDENTIAL_TYPES if credential_type.id == type_id), None)


def credential_type_api_dict(credential_type: CredentialType) -> dict[str, object]:
    return {
        "id": credential_type.id,
        "display_name": credential_type.display_name,
        "fields": [
            {"id": field.id, "label": field.label, "secret": field.secret}
            for field in credential_type.field_definitions
        ],
        "node_type_ids": list(credential_type.node_type_ids),
    }


def validate_credential_data(credential_type: CredentialType, data: Mapping[str, str]) -> dict[str, str]:
    expected_fields = set(credential_type.fields)
    received_fields = set(data)
    if received_fields != expected_fields:
        missing = sorted(expected_fields - received_fields)
        unexpected = sorted(received_fields - expected_fields)
        details = []
        if missing:
            details.append(f"缺少字段：{', '.join(missing)}")
        if unexpected:
            details.append(f"不支持字段：{', '.join(unexpected)}")
        raise ValueError("；".join(details))

    normalized = {field: value.strip() for field, value in data.items() if isinstance(value, str)}
    if len(normalized) != len(data) or any(not value for value in normalized.values()):
        raise ValueError("凭据字段必须是非空文本")
    return normalized


def credential_type_from_manifest(value: object) -> CredentialType:
    if not isinstance(value, Mapping):
        raise ValueError("凭据类型必须是对象")
    type_id = value.get("id")
    display_name = value.get("displayName")
    node_type_ids = value.get("nodeTypeIds")
    fields = value.get("fields")
    if not isinstance(type_id, str) or not _IDENTIFIER_PATTERN.fullmatch(type_id):
        raise ValueError("凭据类型 ID 只能包含字母、数字、点、下划线和短横线")
    if not isinstance(display_name, str) or not display_name.strip():
        raise ValueError("凭据类型 displayName 必须是非空字符串")
    if not isinstance(node_type_ids, list) or not node_type_ids or not all(
        isinstance(node_type_id, str) and node_type_id.strip() for node_type_id in node_type_ids
    ):
        raise ValueError("凭据类型 nodeTypeIds 必须是非空字符串数组")
    if len(set(node_type_ids)) != len(node_type_ids):
        raise ValueError("凭据类型 nodeTypeIds 不能重复")
    if not isinstance(fields, list) or not fields:
        raise ValueError("凭据类型 fields 必须是非空数组")

    parsed_fields: list[CredentialField] = []
    field_ids: set[str] = set()
    for field in fields:
        if not isinstance(field, Mapping):
            raise ValueError("凭据字段必须是对象")
        field_id = field.get("id")
        label = field.get("label")
        secret = field.get("secret")
        if not isinstance(field_id, str) or not _FIELD_IDENTIFIER_PATTERN.fullmatch(field_id):
            raise ValueError("凭据字段 ID 只能包含字母、数字和下划线")
        if field_id in field_ids:
            raise ValueError("凭据字段 ID 不能重复")
        if not isinstance(label, str) or not label.strip():
            raise ValueError("凭据字段 label 必须是非空字符串")
        if not isinstance(secret, bool):
            raise ValueError("凭据字段 secret 必须是布尔值")
        field_ids.add(field_id)
        parsed_fields.append(CredentialField(field_id, label.strip(), secret))

    return CredentialType(
        id=type_id,
        display_name=display_name.strip(),
        field_definitions=tuple(parsed_fields),
        node_type_ids=tuple(node_type_ids),
    )


class CredentialVault:
    """Encrypts credential payloads with a portable AES-256-GCM service key."""

    def __init__(self) -> None:
        self._service_key_source: ServiceCredentialKey | None = None

    def _service_key(self, *, create: bool) -> bytes:
        from .service_credential_key import ServiceCredentialKey

        if self._service_key_source is None:
            self._service_key_source = ServiceCredentialKey()
        return self._service_key_source.key(create=create)

    def encrypt(self, data: Mapping[str, str]) -> str:
        payload = json.dumps(dict(data), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        key = self._service_key(create=True)
        nonce = os.urandom(12)
        encrypted = _SERVICE_CIPHERTEXT_HEADER + nonce + AESGCM(key).encrypt(
            nonce, payload, _SERVICE_CIPHERTEXT_HEADER,
        )
        return base64.b64encode(encrypted).decode("ascii")

    def decrypt(self, encrypted_data: str) -> dict[str, str]:
        try:
            encrypted = base64.b64decode(encrypted_data.encode("ascii"), validate=True)
            offset = len(_SERVICE_CIPHERTEXT_HEADER)
            if not encrypted.startswith(_SERVICE_CIPHERTEXT_HEADER) or len(encrypted) < offset + 12 + 16:
                raise ValueError("Unsupported or truncated credential ciphertext")
            payload = AESGCM(self._service_key(create=False)).decrypt(
                encrypted[offset:offset + 12], encrypted[offset + 12:], _SERVICE_CIPHERTEXT_HEADER,
            )
            decoded = json.loads(payload.decode("utf-8"))
        except (UnicodeError, ValueError, InvalidTag) as exc:
            raise ValueError("Credential ciphertext is invalid") from exc

        if not isinstance(decoded, dict) or not all(
            isinstance(key, str) and isinstance(value, str) for key, value in decoded.items()
        ):
            raise ValueError("Credential payload must contain string fields")
        return decoded
