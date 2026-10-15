"""Resolve package-declared profile references and validate run snapshots."""
from .config_bindings import resolve_runtime_value


def profile_types(registry):
    result = {}
    for node in registry.list_node_types():
        spec = node.node_class.profile_type
        if spec is not None:
            if spec.id in result and result[spec.id].to_dict() != spec.to_dict():
                raise ValueError(f"配置档类型声明冲突：{spec.id}")
            result[spec.id] = spec
    return result


def referenced_profiles(nodes, context=None):
    for node in nodes:
        if node.config.get("profile_id"):
            profile_id = resolve_runtime_value(node, "profile_id", context) if context is not None else node.config["profile_id"]
            if not isinstance(profile_id, str) or not profile_id:
                raise ValueError("配置档引用必须解析为非空 ID 字符串")
            yield profile_id
        for subflow in node.subflows.values():
            yield from referenced_profiles(subflow.nodes, context)


def validate_run_profiles(nodes, registry, profiles, credential_lookup, overrides=None, context=None):
    for node in nodes:
        if node.disabled:
            continue
        spec = registry.get(node.type).node_class.profile_type if registry.has(node.type) else None
        if spec is not None:
            profile_id = resolve_runtime_value(node, "profile_id", context or {}) if "profile_id" in node.config else None
            if not isinstance(profile_id, str) or not profile_id:
                raise ValueError("配置档引用必须解析为非空 ID 字符串")
            profile = profiles.get(profile_id)
            if not profile or profile["type_id"] != spec.id:
                raise ValueError(f"节点 {node.label or node.id} 的配置档不存在或类型不匹配")
            spec.model.model_validate(profile["data"], extra="forbid")
            credential_id = profile.get("credential_id")
            if credential_id:
                credential = credential_lookup((overrides or {}).get(credential_id, credential_id))
                if credential is None or (spec.credential_type_ids and credential.type_id not in spec.credential_type_ids):
                    raise ValueError("配置档凭据不存在或类型不匹配")
            elif spec.credential_type_ids:
                raise ValueError("配置档缺少凭据")
        for subflow in node.subflows.values():
            validate_run_profiles(subflow.nodes, registry, profiles, credential_lookup, overrides, context)
