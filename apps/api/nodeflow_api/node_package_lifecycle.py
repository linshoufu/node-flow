"""Persistent lifecycle policy for locally discovered node packages."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class NodePackagePolicy:
    package_id: str
    enabled: bool = True
    locked_version: str | None = None
    updated_at: str | None = None

