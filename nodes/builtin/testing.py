from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import Field

from nodeflow_sdk import BaseNode, FormField, FormGroup, Input, NodeConfig, NodeContext, NodeForm, Output, node
from nodes.builtin._schemas import ANY_JSON_SCHEMA, ASSERTION_RESULT_SCHEMA, ERROR_SCHEMA, TEST_REPORT_SCHEMA


class RecordResultConfig(NodeConfig):
    name: str = Field(default="Assertion", title="Result name")


@node(
    id="test.record_result",
    name="Record Test Result",
    category="Testing",
    description="Record one test result.",
    group="action",
    icon="list-checks",
    tags=["testing", "report"],
    keywords=["case", "result", "assertion", "record"],
    documentation_url="/docs/nodes/index.html#test.record_result",
    form=NodeForm(
        groups=(
            FormGroup(
                "result",
                "测试结果",
                fields=(
                    FormField("name", label="用例名称", placeholder="例如：用户登录成功"),
                ),
            ),
        )
    ),
)
class RecordResultNode(BaseNode[RecordResultConfig]):
    inputs = {"input": Input(display_name="断言结果", required=True, description="Assertion result", schema=ASSERTION_RESULT_SCHEMA)}
    outputs = {"success": Output(display_name="记录结果", description="Recorded result", schema=ASSERTION_RESULT_SCHEMA)}

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": inputs.get("input")}


class SummaryConfig(NodeConfig):
    fail_run_on_failed: bool = False


@node(
    id="test.summary",
    name="Test Summary",
    category="Testing",
    description="Summarize recorded test results.",
    group="action",
    icon="bar-chart",
    tags=["testing", "report"],
    keywords=["summary", "aggregate", "passed", "failed"],
    documentation_url="/docs/nodes/index.html#test.summary",
    form=NodeForm(
        groups=(
            FormGroup(
                "failure",
                "失败策略",
                fields=(
                    FormField("fail_run_on_failed", control="switch", label="发现失败时终止运行"),
                ),
            ),
        )
    ),
)
class SummaryNode(BaseNode[SummaryConfig]):
    inputs = {"input": Input(display_name="上游完成", required=False, description="Upstream completion", schema=ANY_JSON_SCHEMA)}
    outputs = {
        "success": Output(display_name="汇总", description="No failures or failure is tolerated", schema=TEST_REPORT_SCHEMA),
        "failed": Output(display_name="失败汇总", description="Recorded failures found", schema=TEST_REPORT_SCHEMA),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": {"summary": {"total": 0, "passed": 0, "failed": 0}, "results": []}}


class WriteReportConfig(NodeConfig):
    path: str = Field(..., title="Report file path")


@node(
    id="test.write_report",
    name="Write Test Report",
    category="Testing",
    description="Write a JSON test report.",
    group="action",
    icon="file-output",
    tags=["testing", "report", "file"],
    keywords=["json", "report", "write", "export"],
    documentation_url="/docs/nodes/index.html#test.write_report",
    form=NodeForm(
        groups=(
            FormGroup(
                "output",
                "输出",
                fields=(
                    FormField("path", label="报告输出路径", placeholder="reports/api-test-report.json"),
                ),
            ),
        )
    ),
)
class WriteReportNode(BaseNode[WriteReportConfig]):
    inputs = {"input": Input(display_name="报告", required=True, description="Report data", schema=TEST_REPORT_SCHEMA)}
    outputs = {
        "success": Output(display_name="已写入", description="Written report", schema={"type": "object", "properties": {"path": {"type": "string"}, "report": TEST_REPORT_SCHEMA}}),
        "error": Output(display_name="错误", category="error", description="Write error", schema=ERROR_SCHEMA),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        report = inputs.get("input")
        try:
            report_path = Path(self.config.path)
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as exc:
            return {
                "error": {
                    "message": str(exc),
                    "type": exc.__class__.__name__,
                    "path": self.config.path,
                }
            }

        return {
            "success": {
                "path": str(report_path),
                "report": report,
            }
        }
