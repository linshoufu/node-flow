from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def credential_reference_fields(
    config: Mapping[str, Any], form: Mapping[str, Any] | None,
) -> list[tuple[str, str, tuple[str, ...]]]:
    """Returns configured credential IDs declared by a node form.

    The credential_id fallback preserves workflows created before node forms were
    introduced. New nodes can declare one or more credential controls.
    """

    declared_fields: dict[str, tuple[str, ...]] = {}
    if isinstance(form, Mapping):
        groups = form.get("groups")
        if isinstance(groups, list):
            for group in groups:
                if not isinstance(group, Mapping) or not isinstance(group.get("fields"), list):
                    continue
                for field in group["fields"]:
                    if not isinstance(field, Mapping) or field.get("control") != "credential":
                        continue
                    key = field.get("key")
                    type_ids = field.get("credentialTypeIds", [])
                    if isinstance(key, str) and isinstance(type_ids, list) and all(
                        isinstance(type_id, str) for type_id in type_ids
                    ):
                        declared_fields[key] = tuple(type_ids)

    if "credential_id" in config and "credential_id" not in declared_fields:
        declared_fields["credential_id"] = ()

    return [
        (key, value, type_ids)
        for key, type_ids in declared_fields.items()
        if isinstance((value := config.get(key)), str) and value
    ]
