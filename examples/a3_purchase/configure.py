"""Migrate one saved A3 example to declarative nodes. Never creates a run."""
import argparse
import copy
import json
from pathlib import Path

import httpx

from nodes.builtin.records import merge_group_fields


def bind_workflow(template, previous, profile, http_profile_id):
    workflow = copy.deepcopy(template)
    workflow.update({key: previous[key] for key in ("id", "name", "version", "description", "tags") if key in previous})
    workflow["active"] = False
    workflow["settings"] = {**previous.get("settings", {}), **workflow["settings"], "run_mode": "preview"}
    nodes = {node["id"]: node for node in workflow["nodes"]}
    old = {node["id"]: node for node in previous["nodes"]}
    if "params" in old:
        nodes["params"]["config"] = copy.deepcopy(old["params"]["config"])
    data = copy.deepcopy(profile["data"])
    data["categories"] = list(data.pop("stock_in_categories").values())
    data.pop("base_url", None)
    data.setdefault("default_warehouse", None)
    workflow["settings"]["configuration"] = [{"name": field["name"], "label": field.get("label", field["name"]), "type": field["type"], "required": data[field["name"]] is not None, "default": data[field["name"]]} for field in template["settings"]["configuration"]]
    old_group_by = old.get("tasks", {}).get("config", {}).get("group_by")
    if old_group_by:
        aliases = {"源单单号": "order_code", "仓库": "warehouse_name", "仓库ID": "warehouse_id", "过账日期": "posting_date", "单据日期": "order_date", "单据类别": "category", "单据编码": "document_code"}
        if any(key not in aliases for key in old_group_by):
            raise ValueError("现有示例包含额外分组列，需要先在字段映射中声明")
        config = nodes["tasks"]["config"]
        fields = config["common_fields"]
        labels = {field["name"]: field.get("label", field["name"]) for field in fields}
        config["common_fields"] = [{**field, "label": labels.get(field["name"], field["name"])} for field in merge_group_fields({
            "by": [aliases[key] for key in old_group_by],
            "header_fields": [field["name"] for field in fields if field.get("emit", True)],
            "optional_keys": [field["name"] for field in fields if field.get("allow_empty", False)],
        })]
    for owner in workflow["nodes"]:
        for body in owner.get("subflows", {}).values():
            for node in body["nodes"]:
                if node["type"] == "http.request":
                    node["config"]["http_profile_id"] = http_profile_id
    return workflow


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workflow_id")
    parser.add_argument("--api", default="http://127.0.0.1:8150")
    parser.add_argument("--database", default="node-flow.sqlite3")
    args = parser.parse_args()
    # Restrict credential migration to the local platform, never an external API.
    if httpx.URL(args.api).host not in {"127.0.0.1", "localhost"}:
        raise ValueError("迁移仅允许连接本机平台")
    from apps.api.nodeflow_api.storage import Storage
    from apps.api.nodeflow_api.credentials import CredentialVault
    client = httpx.Client(base_url=args.api, timeout=30, trust_env=False)
    def request(method, path, **kwargs):
        response = client.request(method, path, **kwargs)
        if response.is_error:
            raise ValueError(f"本地平台请求失败：{method} {path} HTTP {response.status_code}")
        return response.json()
    previous = request("GET", f"/api/workflows/{args.workflow_id}")
    template = json.loads(Path(__file__).with_name("workflow.json").read_text(encoding="utf-8"))
    def walk(nodes):
        for node in nodes:
            yield node
            for body in node.get("subflows", {}).values():
                yield from walk(body["nodes"])
    profile_ids = {node["config"]["profile_id"] for node in walk(previous["nodes"]) if node.get("config", {}).get("profile_id")}
    if len(profile_ids) != 1:
        raise ValueError("迁移要求示例明确引用同一个 A3 业务配置档")
    profile = next(profile for profile in request("GET", "/api/profiles") if profile["id"] in profile_ids)
    # Read only the encrypted credential record; plaintext exists in memory only.
    storage = Storage(args.database)
    try:
        credential = storage.get_credential(profile["credential_id"])
        secret = CredentialVault().decrypt(credential.encrypted_data)
    finally:
        storage.close()
    account_name = profile["name"] + " · HTTP 账号"
    existing = next((item for item in request("GET", "/api/credentials") if item["name"] == account_name and item["type_id"] == "http.login"), None)
    account = existing or request("POST", "/api/credentials", json={"name": account_name, "type_id": "http.login", "data": {"tenant": secret["tenancy_code"], "username": secret["username"], "password": secret["password"]}})
    http_profile = json.loads(Path(__file__).with_name("http-profile.example.json").read_text(encoding="utf-8"))
    http_profile.update(name=profile["name"] + " · 通用 HTTP", base_url=profile["data"]["base_url"], credential_id=account["id"], timeout_seconds=int(profile["data"].get("timeout_seconds", 30)))
    client_type = profile["data"].get("client_type", "mom_web")
    http_profile["headers"]["client_type"] = client_type
    http_profile["authentication"]["login"]["body"]["clientType"] = client_type
    existing_http = next((item for item in request("GET", "/api/http-profiles") if item["name"] == http_profile["name"]), None)
    bound_http = existing_http or request("POST", "/api/http-profiles", json=http_profile)
    workflow = bind_workflow(template, previous, profile, bound_http["id"])
    backup = Path(".tmp") / f"{args.workflow_id}-before-generic-v{previous['version']}.json"
    backup.parent.mkdir(exist_ok=True)
    if not backup.exists():
        backup.write_text(json.dumps(previous, ensure_ascii=False, indent=2), encoding="utf-8")
    saved = request("POST", "/api/workflows", json=workflow, headers={"X-Workflow-Expected-Version": str(previous["version"])})
    print(f"已迁移工作流 {saved['id']} v{saved['version']}；预演模式、未激活，未创建运行。")


if __name__ == "__main__":
    main()
