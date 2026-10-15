from typing import Any

from pydantic import Field

from nodeflow_sdk import BaseNode, FormField, FormGroup, NodeConfig, NodeContext, NodeForm, Output, node
from nodes.builtin._schemas import ANY_JSON_SCHEMA


class ScheduleTriggerConfig(NodeConfig):
    interval_seconds: int = Field(default=300, ge=10, le=604800)


@node(
    id="schedule.trigger",
    name="Schedule Trigger",
    category="Triggers",
    description="Start an enabled workflow repeatedly at a fixed interval.",
    group="trigger",
    icon="clock-3",
    tags=["trigger", "schedule", "automation"],
    keywords=["schedule", "interval", "timer", "trigger"],
    documentation_url="/docs/nodes/index.html#schedule.trigger",
    form=NodeForm(
        groups=(
            FormGroup(
                "schedule",
                "触发配置",
                fields=(
                    FormField("interval_seconds", control="number", label="间隔（秒）", expression="disabled"),
                ),
            ),
        )
    ),
)
class ScheduleTriggerNode(BaseNode[ScheduleTriggerConfig]):
    effect = "pure"
    preview_support = "execute"
    outputs = {
        "success": Output(
            display_name="触发数据",
            description="Schedule trigger details",
            schema=ANY_JSON_SCHEMA,
        )
    }

    async def execute(self, ctx: NodeContext, inputs: dict[str, Any]) -> dict[str, Any]:
        return {"success": ctx.data.get("workflow_input", {})}
