"""Preview preflight shared by manual launch, workers and nested workflows."""
from .config_bindings import resolve_runtime_value, resolve_workflow_bindings


def _literal_markers(original, resolved):
    return [node.model_copy(update={
        "configBindings": source.configBindings,
        "subflows": {key: body.model_copy(update={"nodes": _literal_markers(source.subflows[key].nodes, body.nodes)}) for key, body in node.subflows.items()},
    }) for source, node in zip(original, resolved)]


def validate_preview(workflow, registry, workflow_lookup, context=None, ancestors=(), *, _bindings_resolved=False):
    if not _bindings_resolved:
        original = workflow
        workflow = resolve_workflow_bindings(workflow, registry, parameters=(context or {}).get("run_parameters"), runtime=False)
        # Preserve literal binding markers for fields used by preflight itself.
        workflow = workflow.model_copy(update={"nodes": _literal_markers(original.nodes, workflow.nodes)})
    if workflow.id in ancestors:
        raise ValueError("预演不允许递归工作流")
    ancestors = (*ancestors, workflow.id)
    for node in workflow.nodes:
        if node.disabled:
            continue
        if not registry.has(node.type):
            raise ValueError(f"节点 {node.id} 类型不可用，不能预演")
        cls = registry.get(node.type).node_class
        if cls.preview_support not in {"execute", "plan"} or cls.effect not in {"pure", "read", "write", "unknown"}:
            raise ValueError(f"节点 {node.id}（{node.type}）尚不支持平台预演")
        if cls.preview_support == "execute" and cls.effect not in {"pure", "read"}:
            raise ValueError(f"节点 {node.id} 有副作用，不能直接用于预演")
        if cls.preview_support == "plan":
            from nodeflow_sdk import BaseNode
            if cls.preview is BaseNode.preview:
                raise ValueError(f"节点 {node.id} 缺少预演实现")
        if node.type == "workflow.execute":
            try:
                child_id = resolve_runtime_value(node, "workflow_id", context or {})
                child = workflow_lookup(child_id) if isinstance(child_id, str) else None
            except Exception:
                child = None
            if child is None:
                raise ValueError(f"节点 {node.id} 的目标工作流不能在预演前确定")
            validate_preview(child, registry, workflow_lookup, {**(context or {}), "run_parameters": {}}, ancestors)
        for body in node.subflows.values():
            validate_preview(workflow.model_copy(update={"nodes": body.nodes}), registry, workflow_lookup, context, ancestors[:-1], _bindings_resolved=True)
