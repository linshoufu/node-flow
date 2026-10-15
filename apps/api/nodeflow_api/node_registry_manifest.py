"""节点表单覆盖清单（manifest）读写与合并逻辑。

manifest 放在 py 文件旁，命名为 <stem>.nodeform.json，
编辑结果不写回 py 源码，删除 manifest 后系统无缝回退到纯 py 声明。
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from nodeflow_sdk import NodeFormManifest

logger = logging.getLogger(__name__)

MANIFEST_SUFFIX = ".nodeform.json"
SUPPORTED_CONTROLS = frozenset({
    "text", "textarea", "password", "number", "switch",
    "select", "json", "dynamic_output_list", "dynamic_input_list", "http_profile", "column_rules", "mapping_rules", "group_fields",
    "url", "credential", "parameter_list", "string_list",
})


def manifest_path_for(py_file: Path) -> Path:
    """给定 py 源文件路径，返回对应的 manifest 路径。"""
    return py_file.with_suffix(MANIFEST_SUFFIX)


def read_manifest(py_file: Path) -> dict[str, Any] | None:
    """读取 manifest 文件，不存在或损坏时返回 None。"""
    manifest_path = manifest_path_for(py_file)
    if not manifest_path.is_file():
        return None
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            logger.warning("manifest 不是 JSON 对象，已忽略：%s", manifest_path)
            return None
        # 用 Pydantic 模型校验结构
        NodeFormManifest.model_validate(raw)
        return raw
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        logger.warning("manifest 读取失败，已降级为纯 py 声明：%s（%s）", manifest_path, exc)
        return None


def write_manifest(py_file: Path, manifest: dict[str, Any]) -> None:
    """原子写入 manifest 文件。"""
    manifest_path = manifest_path_for(py_file)
    # 用 Pydantic 校验结构
    NodeFormManifest.model_validate(manifest)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = manifest_path.with_suffix(f"{MANIFEST_SUFFIX}.tmp")
    try:
        temporary.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(temporary, manifest_path)
    finally:
        temporary.unlink(missing_ok=True)


def delete_manifest(py_file: Path) -> bool:
    """删除 manifest 文件，返回是否确实删除了文件。"""
    manifest_path = manifest_path_for(py_file)
    if not manifest_path.is_file():
        return False
    manifest_path.unlink()
    return True


def merge_form_with_manifest(
    py_form: dict[str, Any] | None,
    manifest: dict[str, Any] | None,
    config_schema: dict[str, Any],
) -> dict[str, Any] | None:
    """将 py 声明的 form 与 manifest 覆盖层合并。

    合并规则：
    1. 若 manifest 有 form，使用 manifest 的 form（完全替换 py 声明）
    2. 若 manifest 有 placements，注入到 form 各字段
    3. 若 manifest 有 defaults，暂不注入到 form 本身（由调用方处理 config_schema）

    返回合并后的 form dict，若结果无效则返回 None（降级到自动生成）。
    """
    if manifest is None:
        # 无 manifest，走纯 py 声明路径，仅注入 placements 不存在的情况
        return _inject_placements_to_form(py_form, None) if py_form else None

    manifest_form = manifest.get("form")
    manifest_placements: dict[str, str] | None = manifest.get("placements")  # type: ignore[assignment]

    # 决定基础 form：优先 manifest.form，否则 py_form
    base_form = manifest_form if isinstance(manifest_form, dict) and manifest_form.get("groups") else py_form

    if base_form is None:
        return None

    # 注入 placement
    merged = dict(base_form)
    merged = _inject_placements_to_form(merged, manifest_placements)

    # 校验合并结果
    properties = config_schema.get("properties")
    if not isinstance(properties, dict):
        return None

    try:
        _validate_merged_form(merged, properties)
    except ValueError as exc:
        logger.warning("manifest 合并后表单无效，降级为自动生成：%s", exc)
        return None

    return merged


def apply_manifest_defaults(
    config_schema: dict[str, Any],
    manifest: dict[str, Any] | None,
) -> dict[str, Any]:
    """将 manifest.defaults 注入到 config_schema 的 properties 默认值中。"""
    if manifest is None:
        return config_schema
    manifest_defaults = manifest.get("defaults")
    if not isinstance(manifest_defaults, dict) or not manifest_defaults:
        return config_schema

    properties = config_schema.get("properties")
    if not isinstance(properties, dict):
        return config_schema

    updated_properties = dict(properties)
    for key, default_value in manifest_defaults.items():
        if key in updated_properties:
            field_schema = dict(updated_properties[key])
            field_schema["default"] = default_value
            updated_properties[key] = field_schema

    return {**config_schema, "properties": updated_properties}


def apply_manifest_port_presentation(
    ports: dict[str, dict[str, Any]],
    manifest: dict[str, Any] | None,
    direction: str,
) -> dict[str, dict[str, Any]]:
    """Apply display-only port metadata without changing the Python port contract.

    This deliberately works on serialized API metadata, never on ``BaseNode.inputs``
    or ``BaseNode.outputs``. Runtime validation and execution therefore keep using
    the ports declared in Python.
    """
    if manifest is None:
        return ports
    root = manifest.get("portPresentation")
    if not isinstance(root, dict):
        return ports
    overrides = root.get(direction)
    if not isinstance(overrides, dict):
        return ports

    decorated: list[tuple[str, dict[str, Any], int, int]] = []
    for source_index, (handle, port) in enumerate(ports.items()):
        override = overrides.get(handle)
        updated = dict(port)
        order = source_index
        has_explicit_order = 1
        if isinstance(override, dict):
            display_name = override.get("displayName")
            description = override.get("description")
            collapsed = override.get("collapsed")
            explicit_order = override.get("order")
            if isinstance(display_name, str) and display_name.strip():
                updated["displayName"] = display_name.strip()
            if isinstance(description, str):
                updated["description"] = description.strip()
            if isinstance(collapsed, bool) and collapsed:
                updated["collapsed"] = True
            if isinstance(explicit_order, int) and not isinstance(explicit_order, bool):
                order = explicit_order
                has_explicit_order = 0
        decorated.append((handle, updated, has_explicit_order, order))

    decorated.sort(key=lambda item: (item[2], item[3]))
    return {handle: port for handle, port, _, _ in decorated}


def _inject_placements_to_form(
    form: dict[str, Any] | None,
    placements: dict[str, str] | None,
) -> dict[str, Any] | None:
    """将 placement 注入到 form 的各字段中。"""
    if not placements:
        return form
    if form is None:
        return None

    groups = form.get("groups")
    if not isinstance(groups, list):
        return form

    updated_groups = []
    for group in groups:
        if not isinstance(group, dict):
            updated_groups.append(group)
            continue
        fields = group.get("fields")
        if not isinstance(fields, list):
            updated_groups.append(group)
            continue
        updated_fields = []
        for field in fields:
            if not isinstance(field, dict):
                updated_fields.append(field)
                continue
            key = field.get("key")
            if isinstance(key, str) and key in placements:
                updated_fields.append({**field, "placement": placements[key]})
            else:
                updated_fields.append(field)
        updated_groups.append({**group, "fields": updated_fields})

    return {**form, "groups": updated_groups}


def _validate_merged_form(form: dict[str, Any], properties: dict[str, Any]) -> None:
    """校验合并后 form 的基本有效性。"""
    groups = form.get("groups")
    if not isinstance(groups, list) or not groups:
        raise ValueError("至少需要一个表单分组")

    group_ids: set[str] = set()
    field_keys: set[str] = set()

    for group in groups:
        if not isinstance(group, dict):
            raise ValueError("表单分组必须是对象")
        group_id = group.get("id")
        if not isinstance(group_id, str) or not group_id.strip() or group_id in group_ids:
            raise ValueError("分组 ID 必须唯一且非空")
        group_ids.add(group_id)

        fields = group.get("fields")
        if not isinstance(fields, list) or not fields:
            raise ValueError(f"分组 {group_id} 必须包含字段")

        for field in fields:
            if not isinstance(field, dict):
                raise ValueError(f"分组 {group_id} 包含无效字段")
            key = field.get("key")
            if not isinstance(key, str) or key not in properties:
                raise ValueError(f"字段 {key!r} 未在配置模型中声明")
            if key in field_keys:
                raise ValueError(f"字段 {key} 不能重复出现")
            field_keys.add(key)

            control = field.get("control")
            if control not in SUPPORTED_CONTROLS:
                raise ValueError(f"字段 {key} 使用了不支持的控件 {control!r}")

            placement = field.get("placement")
            if placement is not None and placement not in {"inline", "panel"}:
                raise ValueError(f"字段 {key} 的 placement 必须是 'inline' 或 'panel'")
