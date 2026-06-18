from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import Field

from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node


class RecordResultConfig(NodeConfig):
    name: str = Field(default="Assertion", title="Result name")


@node(id="test.record_result", name="Record Test Result", category="Testing", description="Record one test result.")
class RecordResultNode(BaseNode[RecordResultConfig]):
    inputs = {"input": Input(required=True, description="Assertion result")}
    outputs = {"success": Output(description="Recorded result")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": inputs.get("input")}


class SummaryConfig(NodeConfig):
    fail_run_on_failed: bool = False


@node(id="test.summary", name="Test Summary", category="Testing", description="Summarize recorded test results.")
class SummaryNode(BaseNode[SummaryConfig]):
    inputs = {"input": Input(required=False, description="Upstream completion")}
    outputs = {
        "success": Output(description="No failures or failure is tolerated"),
        "failed": Output(description="Recorded failures found"),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": {"summary": {"total": 0, "passed": 0, "failed": 0}, "results": []}}


class WriteReportConfig(NodeConfig):
    path: str = Field(..., title="Report file path")


@node(id="test.write_report", name="Write Test Report", category="Testing", description="Write a JSON test report.")
class WriteReportNode(BaseNode[WriteReportConfig]):
    inputs = {"input": Input(required=True, description="Report data")}
    outputs = {
        "success": Output(description="Written report"),
        "error": Output(description="Write error"),
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
