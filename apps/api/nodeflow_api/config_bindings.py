"""Explicit typed node configuration bindings, independent of Python node models."""
from copy import deepcopy
import re

from pydantic import ValidationError

from nodeflow_sdk.parameters import RunParametersConfig, validate_parameter
from nodeflow_sdk.non_secret import assert_non_secret
from .run_parameters import parameter_declaration
from .expressions import resolve_expression


def configuration_values(workflow):
    definition = RunParametersConfig(fields=workflow.settings.configuration)
    result = {}
    for field in definition.fields:
        if field.default is None and field.required:
            raise ValueError(f"工作流配置 {field.label or field.name} 缺少值")
        result[field.name] = validate_parameter(field, field.default) if field.default is not None else None
        assert_non_secret({field.name: result[field.name]})
    return result


def _schema_at(schema, parts, definitions):
    while "$ref" in schema:
        schema = definitions.get(schema["$ref"].rsplit("/", 1)[-1], {})
    if not parts:
        return schema
    if "anyOf" in schema:
        candidates = [_schema_at(branch, parts, definitions) for branch in schema["anyOf"] if branch.get("type") != "null"]
        return next((item for item in candidates if item is not None), None)
    if parts[0] in schema.get("properties", {}):
        return _schema_at(schema["properties"][parts[0]], parts[1:], definitions)
    additional = schema.get("additionalProperties")
    if additional is True or isinstance(additional, dict):
        if additional is True or additional == {}:
            return {}
        return _schema_at(additional if isinstance(additional, dict) else {}, parts[1:], definitions) if parts[1:] else (additional if isinstance(additional, dict) else {})
    return None


def _types(schema):
    if not schema:
        return set()
    if "anyOf" in schema:
        return set().union(*(_types(item) for item in schema["anyOf"]))
    value = schema.get("type")
    return set(value) if isinstance(value, list) else {value} if value else set()


def bind_node(node, registry, values, declarations, parameters, *, runtime):
    if not node.configBindings or node.disabled:
        return node.model_copy(deep=True)
    if registry is not None and not registry.has(node.type):
        raise ValueError(f"节点类型不存在：{node.type}")
    cls = registry.get(node.type).node_class if registry is not None else None
    schema = cls.config_model().model_json_schema() if cls else {}
    dynamic = [item.config_key for item in (cls.__node_meta__.dynamic_inputs, cls.__node_meta__.dynamic_outputs) if item] if cls else []
    targets = list(node.configBindings)
    for target in targets:
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*", target):
            raise ValueError(f"绑定目标字段路径无效：{target}")
        if any(other != target and other.startswith(target + ".") for other in targets):
            raise ValueError("绑定目标不能互相覆盖")
        if target.split(".")[0] in dynamic:
            raise ValueError("动态端口定义必须固定，不能绑定运行配置")
    config, pending = deepcopy(node.config), {}
    for target, binding in node.configBindings.items():
        parts = target.split(".")
        target_schema = _schema_at(schema, parts, schema.get("$defs", {})) if cls else {}
        if target_schema is None:
            raise ValueError(f"节点配置中不存在绑定字段：{target}")
        if binding.source == "workflow":
            if binding.key not in values:
                raise ValueError(f"工作流配置不存在：{binding.key}")
            value = deepcopy(values[binding.key])
        else:
            field = declarations.get(binding.key)
            if field is None:
                raise ValueError(f"运行参数不存在：{binding.key}")
            source_type = {"file": "string", "date": "string", "json": None}.get(field.type, field.type)
            allowed = _types(target_schema)
            if source_type and allowed and source_type not in allowed and not (source_type == "integer" and "number" in allowed):
                raise ValueError(f"运行参数 {binding.key} 与节点字段 {target} 类型不兼容")
            if parameters is not None and binding.key in parameters:
                value = deepcopy(parameters[binding.key])
            elif runtime:
                raise ValueError(f"运行快照缺少参数：{binding.key}")
            elif field.default is not None:
                value = deepcopy(field.default)
            else:
                pending[target] = binding
                continue
        assert_non_secret({target.split(".")[-1]: value})
        actual_type = "null" if value is None else "boolean" if isinstance(value, bool) else "integer" if isinstance(value, int) else "number" if isinstance(value, float) else "string" if isinstance(value, str) else "array" if isinstance(value, list) else "object"
        allowed = _types(target_schema)
        if allowed and actual_type not in allowed and not (actual_type == "integer" and "number" in allowed):
            raise ValueError(f"绑定值与节点字段 {target} 类型不兼容")
        current = config
        for part in parts[:-1]:
            if part not in current:
                current[part] = {}
            if not isinstance(current[part], dict):
                raise ValueError(f"绑定路径不是对象：{target}")
            current = current[part]
        current[parts[-1]] = value
    if runtime and cls:
        try:
            cls.config_model().model_validate(config, extra="forbid")
        except ValidationError as exc:
            # Unbound expressions and other inputs may only resolve at node execution.
            roots = {target.split(".")[0] for target in targets}
            errors = [error for error in exc.errors() if not error["loc"] or str(error["loc"][0]) in roots]
            if errors:
                raise ValueError(f"节点 {node.label or node.id} 的绑定值不符合配置约束：{errors[0]['msg']}") from None
    return node.model_copy(update={"config": config, "configBindings": node.configBindings if runtime else pending})


def resolve_workflow_bindings(workflow, registry, *, configuration=None, parameters=None, runtime=False):
    values = configuration_values(workflow) if configuration is None else deepcopy(configuration)
    declaration = parameter_declaration(workflow)
    declarations = {field.name: field for field in declaration.fields} if declaration else {}
    def visit(nodes):
        result = []
        for node in nodes:
            resolved = bind_node(node, registry, values, declarations, parameters, runtime=runtime)
            resolved = resolved.model_copy(update={"subflows": {key: body.model_copy(update={"nodes": visit(body.nodes)}) for key, body in node.subflows.items()}})
            result.append(resolved)
        return result
    return workflow.model_copy(update={"nodes": visit(workflow.nodes)})


def resolve_runtime_config(node, context, *, expressions=True):
    """Bound values are literal data, never a second layer of expression source."""
    config = deepcopy(node.config)
    literals = {}
    for target in node.configBindings:
        current = config
        parts = target.split(".")
        for part in parts[:-1]:
            current = current[part]
        literals[target] = current.pop(parts[-1])
    config = resolve_expression(config, context) if expressions else config
    for target, value in literals.items():
        current = config
        parts = target.split(".")
        for part in parts[:-1]:
            current = current.setdefault(part, {})
        current[parts[-1]] = value
    return config


def resolve_runtime_value(node, key, context):
    return deepcopy(node.config[key]) if key in node.configBindings else resolve_expression(node.config[key], context)
