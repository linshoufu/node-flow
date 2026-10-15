from pathlib import Path

from apps.api.nodeflow_api.node_registry import NodeRegistry


def write_node(path: Path, *, node_id: str, form_source: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f'''
from nodeflow_sdk import BaseNode, FormField, FormGroup, NodeConfig, NodeForm, node


class Config(NodeConfig):
    method: str = "GET"
    url: str = ""


@node(
    id="{node_id}",
    name="Form node",
    category="Test",
    form={form_source},
)
class FormNode(BaseNode[Config]):
    pass
'''.lstrip(),
        encoding="utf-8",
    )


def test_registry_serializes_declared_form_metadata(tmp_path: Path):
    write_node(
        tmp_path / "form_node.py",
        node_id="example.form",
        form_source='''NodeForm(groups=(
    FormGroup("request", "请求", fields=(
        FormField("method", control="select", options=(("GET", "GET"), ("POST", "POST"))),
        FormField("url", control="url", label="地址"),
    )),
))''',
    )

    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()

    assert registry.get("example.form").to_api_dict()["form"] == {
        "groups": [
            {
                "id": "request",
                "label": "请求",
                "fields": [
                    {
                        "key": "method",
                        "control": "select",
                        "options": [
                            {"value": "GET", "label": "GET"},
                            {"value": "POST", "label": "POST"},
                        ],
                    },
                    {"key": "url", "control": "url", "label": "地址"},
                ],
            }
        ]
    }


def test_invalid_node_form_is_diagnostic_but_node_still_registers(tmp_path: Path):
    write_node(
        tmp_path / "invalid_form.py",
        node_id="example.invalid_form",
        form_source='NodeForm(groups=(FormGroup("request", "请求", fields=(FormField("missing"),)),))',
    )

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.has("example.invalid_form")
    assert registry.get("example.invalid_form").to_api_dict()["form"] is None
    assert [diagnostic.code for diagnostic in result.diagnostics] == ["node_form_invalid"]


def test_invalid_expression_mode_is_diagnostic_but_node_still_registers(tmp_path: Path):
    write_node(
        tmp_path / "invalid_expression.py",
        node_id="example.invalid_expression",
        form_source='NodeForm(groups=(FormGroup("request", "请求", fields=(FormField("method", expression="unsupported"),)),))',
    )

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.has("example.invalid_expression")
    assert registry.get("example.invalid_expression").to_api_dict()["form"] is None
    assert [diagnostic.code for diagnostic in result.diagnostics] == ["node_form_invalid"]


def test_http_request_advertises_grouped_form_contract():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()

    form = registry.get("http.request").to_api_dict()["form"]

    assert [group["label"] for group in form["groups"]] == ["请求配置档", "请求", "内容", "认证"]
    profile = form["groups"][0]["fields"][0]
    body = next(field for field in form["groups"][2]["fields"] if field["key"] == "body")
    credential = next(field for field in form["groups"][3]["fields"] if field["key"] == "credential_id")
    assert profile["control"] == "http_profile"
    assert body["visibleWhen"] == {"field": "method", "oneOf": ["POST", "PUT", "PATCH"]}
    assert "credentialTypeIds" not in credential


def test_webhook_trigger_advertises_sync_and_immediate_response_modes():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()

    form = registry.get("webhook.trigger").to_api_dict()["form"]
    response_mode = next(
        field for field in form["groups"][0]["fields"] if field["key"] == "response_mode"
    )

    assert response_mode == {
        "key": "response_mode",
        "control": "select",
        "label": "响应方式",
        "options": [
            {"value": "sync", "label": "等待工作流完成"},
            {"value": "immediate", "label": "立即确认，后台执行"},
        ],
    }


def test_api_testing_template_nodes_advertise_grouped_form_contracts():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()

    csv_form = registry.get("data.csv_read").to_api_dict()["form"]
    status_form = registry.get("assert.status_code").to_api_dict()["form"]
    record_form = registry.get("test.record_result").to_api_dict()["form"]
    summary_form = registry.get("test.summary").to_api_dict()["form"]
    report_form = registry.get("test.write_report").to_api_dict()["form"]

    assert [group["label"] for group in csv_form["groups"]] == ["文件", "解析"]
    assert csv_form["groups"][0]["fields"][0] == {
        "key": "path",
        "control": "text",
        "label": "固定文件路径（未连接路径时使用）",
        "placeholder": "也可连接文件路径输入端口",
    }
    assert [field["control"] for field in csv_form["groups"][1]["fields"]] == ["text", "text", "switch"]

    assert status_form["groups"][0]["fields"][0] == {
        "key": "expected",
        "control": "number",
        "label": "期望状态码",
    }
    assert record_form["groups"][0]["fields"][0]["label"] == "用例名称"
    assert summary_form["groups"][0]["fields"][0] == {
        "key": "fail_run_on_failed",
        "control": "switch",
        "label": "发现失败时终止运行",
    }
    assert report_form["groups"][0]["fields"][0] == {
        "key": "path",
        "control": "text",
        "label": "报告输出路径",
        "placeholder": "reports/api-test-report.json",
    }


def test_general_workflow_nodes_advertise_grouped_form_contracts():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()

    forms = {
        node_id: registry.get(node_id).to_api_dict()["form"]
        for node_id in (
            "control.foreach",
            "control.each_item",
            "control.while",
            "logic.if",
            "logic.set_variable",
            "utility.transform",
            "utility.log",
            "utility.delay",
            "data.extract",
            "data.map_items",
            "data.filter_items",
            "workflow.execute",
        )
    }

    assert [group["label"] for group in forms["control.foreach"]["groups"]] == ["循环数据", "执行限制", "错误处理"]
    assert forms["control.foreach"]["groups"][0]["fields"][0]["control"] == "textarea"
    assert forms["control.each_item"]["groups"][1]["fields"][0]["label"] == "单项失败后继续"
    assert forms["control.while"]["groups"][0]["fields"][0] == {
        "key": "condition",
        "control": "textarea",
        "label": "循环条件",
        "placeholder": "{{ vars.should_continue }}",
        "expression": "required",
    }

    assert forms["logic.if"]["groups"][0]["fields"][0]["label"] == "分支条件"
    assert [field["label"] for field in forms["logic.set_variable"]["groups"][0]["fields"]] == ["变量名称", "变量值"]
    assert forms["utility.transform"]["groups"][0]["fields"][0]["control"] == "textarea"
    assert forms["utility.log"]["groups"][0]["fields"][0]["label"] == "日志内容"
    assert forms["utility.delay"]["groups"][0]["fields"][0]["expression"] == "disabled"

    assert forms["data.extract"]["groups"][0]["fields"][0]["label"] == "数据路径"
    assert forms["data.map_items"]["groups"][0]["fields"][0]["label"] == "映射结果"
    expected_value = forms["data.filter_items"]["groups"][0]["fields"][2]
    assert expected_value["visibleWhen"] == {"field": "operator", "oneOf": ["equals", "not_equals"]}
    assert forms["workflow.execute"]["groups"][0]["fields"][0] == {
        "key": "workflow_id",
        "control": "text",
        "label": "目标工作流",
    }


def test_every_configurable_builtin_node_declares_a_form_contract():
    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()

    missing = [
        node.id
        for node in registry.list_node_types()
        if (node.config_schema or {}).get("properties") and node.form is None
    ]

    assert missing == []
    assert [field["label"] for field in registry.get("assert.equals").form["groups"][0]["fields"]] == ["数据路径", "期望值"]
    assert registry.get("manual.trigger").form["groups"][0]["fields"][0]["control"] == "json"
    assert registry.get("schedule.trigger").form["groups"][0]["fields"][0]["label"] == "间隔（秒）"
    assert [field["label"] for field in registry.get("webhook.trigger").form["groups"][0]["fields"]] == ["请求方法", "请求路径", "响应方式"]
    assert registry.get("webhook.respond").form["groups"][0]["fields"][1]["control"] == "json"
