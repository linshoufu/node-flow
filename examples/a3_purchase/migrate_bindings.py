"""Replace the A3 example's constant options node with workflow configuration."""
import ast
from copy import deepcopy


LABELS = {"purchase_order_menu_code": "采购订单菜单编码", "default_stock_in_category": "默认单据类别", "default_warehouse": "默认仓库", "categories": "单据类别映射"}


def migrate(workflow):
    result = deepcopy(workflow)
    options = next((node for node in result["nodes"] if node["id"] == "options"), None)
    if options is None:
        return result
    if options["type"] != "data.compose" or options["config"].get("rules"):
        raise ValueError("映射选项节点包含动态逻辑，不能自动迁移为固定配置")
    config = options["config"]
    if config.get("fields"):
        values = {}
        for field in config["fields"]:
            if field.get("each") or field.get("fields") or field.get("rules"):
                raise ValueError("映射选项包含动态规则，不能自动迁移")
            values[field["name"]] = ast.literal_eval(field["expression"])
    else:
        values = ast.literal_eval(config["output"])
    outgoing = [edge for edge in result["edges"] if edge["source"] == options["id"]]
    targets = {node["id"]: node for node in result["nodes"]}
    if any(targets[edge["target"]]["type"] != "data.records_prepare" or edge["targetHandle"] != "options" for edge in outgoing):
        raise ValueError("映射选项还有其它用途，需要先明确节点配置目标")
    declarations = result.setdefault("settings", {}).setdefault("configuration", [])
    existing = {field["name"]: field for field in declarations}
    # Connection-level HTTP defaults are already managed by the HTTP profile.
    used = " ".join(str(node["config"]) for node in result["nodes"] if node["id"] != options["id"])
    for key, value in values.items():
        if key in {"client_type", "timeout_seconds"} and f"options.{key}" not in used:
            continue
        if key in existing and existing[key].get("default") != value:
            raise ValueError(f"工作流已存在同名配置且值不同：{key}")
        if key not in existing:
            kind = "boolean" if isinstance(value, bool) else "integer" if isinstance(value, int) else "number" if isinstance(value, float) else "string" if isinstance(value, str) else "json"
            declarations.append({"name": key, "label": LABELS.get(key, key), "type": kind, "required": value is not None, "default": value})
        for edge in outgoing:
            node = targets[edge["target"]]
            target = f"options.{key}"
            binding = {"source": "workflow", "key": key}
            bindings = node.setdefault("configBindings", {})
            if target in bindings and bindings[target] != binding:
                raise ValueError(f"节点已存在不同配置绑定：{target}")
            bindings[target] = binding
    result["nodes"] = [node for node in result["nodes"] if node["id"] != options["id"]]
    result["edges"] = [edge for edge in result["edges"] if options["id"] not in (edge["source"], edge["target"])]
    result["settings"]["run_mode"] = "preview"
    result["active"] = False
    return result
