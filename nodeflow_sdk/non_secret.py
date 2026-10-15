"""Reject credential-shaped fields in public configuration and parameters."""
import json
import re


def assert_non_secret(value):
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = re.sub(r"(?<!^)(?=[A-Z])", "_", str(key)).lower().replace("-", "_")
            if normalized in {"password", "secret", "token", "access_token", "refresh_token", "token_uuid", "api_key", "private_key", "authorization", "cookie"}:
                raise ValueError("敏感字段必须通过凭据引用提供")
            assert_non_secret(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            assert_non_secret(item)
    try:
        json.dumps(value, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError("配置和参数必须是有效 JSON 数据") from exc
