"""Install demo resources and draft workflows through the normal Node Flow API."""

import argparse
import json
from pathlib import Path
import sys

import httpx

from .demo_api import DEMO_PASSWORD, DEMO_USERNAME


DEMO_TAG = "node-flow-demo"
CREDENTIAL_NAME = "Node Flow 演示账号"


def _json(client, method: str, path: str, **kwargs):
    response = client.request(method, path, **kwargs)
    response.raise_for_status()
    return response.json()


def _node(node_id: str, node_type: str, label: str, x: int, config=None, **extra):
    return {"id": node_id, "type": node_type, "typeVersion": 1, "label": label,
            "position": {"x": x, "y": 80}, "config": config or {}, **extra}


def _edge(source: str, output: str, target: str, input_port: str):
    return {"id": f"{source}-{output}-{target}", "source": source, "sourceHandle": output,
            "target": target, "targetHandle": input_port}


def build_workflows(public_profile_id: str, login_profile_id: str, output_dir: Path):
    def request(node_id, label, x, url, method="GET", *, profile=login_profile_id, **extra):
        return _node(node_id, "http.request", label, x,
                     {"http_profile_id": profile, "method": method, "url": url}, **extra)

    single = {
        "id": "demo_http_single", "name": "演示 · 单次接口调用",
        "nodes": [request("echo", "回显请求", 80, "/echo?message=hello-node-flow", profile=public_profile_id)],
        "edges": [],
    }
    chain = {
        "id": "demo_http_chain", "name": "演示 · 登录后串联接口",
        "nodes": [
            request("products", "登录并查询商品", 80, "/products"),
            _node("body", "utility.transform", "引用查询结果", 380, {"value": {
                "reference": "chained-order", "product_id": "{{ inputs.input.body.products.0.id }}", "quantity": 2,
            }}),
            request("order", "提交订单", 680, "/orders", "POST"),
        ],
        "edges": [_edge("products", "success", "body", "input"), _edge("body", "success", "order", "body")],
    }
    body = {
        "nodes": [
            _node("row", "utility.transform", "当前 CSV 行", 80, {"value": "{{ loop.item }}"}),
            request("request", "按行提交订单", 380, "/orders", "POST", execution={"onError": "errorOutput"}),
            _node("assert_status", "assert.status_code", "检查状态码 201", 680, {"expected": 201}),
            _node("record_passed", "test.record_result", "记录成功", 980, {"name": "订单提交"}),
            _node("record_assert_failed", "test.record_result", "记录状态码异常", 980,
                  {"name": "订单提交"}, position={"x": 980, "y": 280}),
            _node("format_error", "utility.transform", "整理接口错误", 680, {"value": {
                "assertion": "http_request", "status": "failed", "message": "接口调用失败",
                "actual": "{{ inputs.input }}",
            }}, position={"x": 680, "y": 480}),
            _node("record_http_error", "test.record_result", "记录接口错误", 980,
                  {"name": "订单提交"}, position={"x": 980, "y": 480}),
        ],
        "edges": [
            _edge("row", "success", "request", "body"),
            _edge("request", "success", "assert_status", "input"),
            _edge("assert_status", "passed", "record_passed", "input"),
            _edge("assert_status", "failed", "record_assert_failed", "input"),
            _edge("request", "error", "format_error", "input"),
            _edge("format_error", "success", "record_http_error", "input"),
        ],
    }
    batch = {
        "id": "demo_http_batch", "name": "演示 · CSV 批量接口调用",
        "nodes": [
            _node("csv", "data.csv_read", "读取演示 CSV", 80,
                  {"path": str(Path(__file__).with_name("demo-cases.csv").resolve()), "encoding": "utf-8"}),
            _node("each", "control.foreach", "逐行调用，失败后继续", 380,
                  {"items_expression": "{{ inputs.input.rows }}", "continue_on_error": True,
                   "max_items": 100, "timeout_seconds": 60}, subflows={"body": body}),
            _node("summary", "test.summary", "汇总每条结果", 680, {"fail_run_on_failed": False}),
            _node("report", "test.write_report", "写入批量报告", 980,
                  {"path": str((output_dir / "batch-report.json").resolve())}),
        ],
        "edges": [_edge("csv", "success", "each", "input"), _edge("each", "done", "summary", "input"),
                  _edge("summary", "success", "report", "input")],
    }
    for workflow in (single, chain, batch):
        workflow.update(active=False, tags=[DEMO_TAG], settings={"timeout_seconds": 90, "max_concurrent_runs": 1})
    return [single, chain, batch]


def prepare_demo(client, *, demo_url: str, output_dir: Path) -> list[dict]:
    credentials = _json(client, "GET", "/api/credentials")
    credential = next((item for item in credentials if item["name"] == CREDENTIAL_NAME and item["type_id"] == "http.login"), None)
    if credential is None:
        credential = _json(client, "POST", "/api/credentials", json={
            "type_id": "http.login", "name": CREDENTIAL_NAME,
            "data": {"tenant": "demo", "username": DEMO_USERNAME, "password": DEMO_PASSWORD},
        })
    authentication = {"mode": "login", "login": {
        "method": "POST", "path": "/login",
        "body": {"username": "{{ credential.username }}", "password": "{{ credential.password }}"},
        "extracts": [{"source": "json", "path": "data.authorization", "target": "header", "name": "Authorization"}],
    }}
    profiles = _json(client, "GET", "/api/http-profiles")
    profile_ids = []
    for name, private in (("Node Flow 演示 · 公共", False), ("Node Flow 演示 · 登录", True)):
        expected = {"name": name, "base_url": demo_url.rstrip("/"), "headers": {"Accept": "application/json"},
                    "timeout_seconds": 5, "credential_id": credential["id"] if private else None,
                    "authentication": authentication if private else {}}
        existing = next((profile for profile in profiles if profile["name"] == name), None)
        if existing is not None and any(existing.get(key) != value for key, value in expected.items()):
            raise ValueError(f"已有配置档“{name}”与演示设置不同，请在资源页面核对；初始化不会覆盖它。")
        profile = existing or _json(client, "POST", "/api/http-profiles", json=expected)
        profile_ids.append(profile["id"])

    prepared = []
    for workflow in build_workflows(*profile_ids, output_dir):
        response = client.get(f"/api/workflows/{workflow['id']}")
        if response.status_code == 404:
            validation = _json(client, "POST", "/api/workflows/validate", json=workflow)
            if not validation["valid"]:
                raise ValueError(f"演示工作流“{workflow['name']}”未通过校验：{validation['issues']}")
            saved = _json(client, "POST", "/api/workflows?draft=true", json=workflow)
        else:
            response.raise_for_status()
            saved = response.json()
            if DEMO_TAG not in saved.get("tags", []):
                raise ValueError(f"工作流 ID {workflow['id']} 已被其他工作流使用，初始化不会覆盖它。")
        prepared.append(saved)

    output_dir.mkdir(parents=True, exist_ok=True)
    for workflow in prepared:
        (output_dir / f"{workflow['id']}.json").write_text(
            json.dumps(workflow, ensure_ascii=False, indent=2), encoding="utf-8",
        )
    return prepared


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="准备 Node Flow 本地接口演示环境")
    parser.add_argument("--api-url", default="http://127.0.0.1:8150")
    parser.add_argument("--demo-url", default="http://127.0.0.1:8160")
    parser.add_argument("--output-dir", type=Path, default=Path(".tmp/demo-workflows"))
    args = parser.parse_args()
    try:
        with httpx.Client(base_url=args.demo_url, trust_env=False, timeout=5) as demo:
            if _json(demo, "GET", "/health").get("service") != "node-flow-demo-api":
                raise ValueError("目标地址不是 Node Flow 演示 API。")
        with httpx.Client(base_url=args.api_url, trust_env=False, timeout=30) as client:
            _json(client, "GET", "/api/health")
            workflows = prepare_demo(client, demo_url=args.demo_url, output_dir=args.output_dir)
        for workflow in workflows:
            print(f"已准备：{workflow['name']} ({workflow['id']})")
        print(f"工作流 JSON 与批量报告目录：{args.output_dir.resolve()}")
        return 0
    except (httpx.HTTPError, ValueError) as exc:
        print(f"演示环境准备失败：{exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
