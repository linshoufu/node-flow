"""Package-owned declarative node presets and workflow/subflow templates."""
import json


def list_templates(registry):
    assets = []
    ids = set()
    for package in registry.list_packages():
        if package.status != "loaded":
            continue
        root = package.root_path.resolve()
        manifest = json.loads((root / "nodeflow-package.json").read_text(encoding="utf-8"))
        for relative in manifest.get("templates", []):
            path = (root / relative).resolve()
            if not path.is_relative_to(root) or path.suffix != ".json":
                raise ValueError("模板文件必须位于节点包内且为 JSON")
            asset = json.loads(path.read_text(encoding="utf-8"))
            if asset.get("kind") not in {"node", "subflow", "workflow"} or not asset.get("id") or not asset.get("name"):
                raise ValueError(f"模板声明无效：{relative}")
            if asset["id"] in ids:
                raise ValueError(f"模板 ID 重复：{asset['id']}")
            ids.add(asset["id"])
            graph = asset.get("workflow", asset.get("graph", {}))
            nodes = [asset["node"]] if asset["kind"] == "node" else graph.get("nodes", [])
            def check(nodes):
                for node in nodes:
                    if not registry.has(node["type"]):
                        raise ValueError(f"模板引用未加载节点：{node['type']}")
                    registry.get(node["type"]).node_class(config=node.get("config", {}))
                    for body in node.get("subflows", {}).values():
                        check(body.get("nodes", []))
            check(nodes)
            assets.append({**asset, "packageId": package.id, "packageVersion": package.version})
    return assets
