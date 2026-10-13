"""Resolve reusable HTTP profile defaults at the execution seam."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from urllib.parse import urljoin, urlparse

from .schemas import HttpProfile


def resolve_http_request_config(config: Mapping[str, Any], profile: HttpProfile | None) -> dict[str, Any]:
    """Return node config with profile defaults applied and node settings preserved.

    The profile identifier is editor-only metadata and is intentionally removed before
    the node's Pydantic configuration is instantiated.
    """
    resolved = dict(config)
    resolved.pop("http_profile_id", None)
    if profile is None:
        return resolved

    raw_url = str(resolved.get("url", "")).strip()
    if profile.base_url and raw_url and not urlparse(raw_url).scheme:
        resolved["url"] = urljoin(f"{profile.base_url}/", raw_url.lstrip("/"))
    if "headers" in resolved:
        resolved["headers"] = {**profile.headers, **dict(resolved["headers"] or {})}
    elif profile.headers:
        resolved["headers"] = dict(profile.headers)
    if not resolved.get("credential_id") and profile.credential_id:
        resolved["credential_id"] = profile.credential_id
    if "timeout_seconds" not in resolved and profile.timeout_seconds is not None:
        resolved["timeout_seconds"] = profile.timeout_seconds
    if profile.authentication and not resolved.get("authentication"):
        resolved["authentication"] = dict(profile.authentication)
    return resolved
