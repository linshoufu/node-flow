from pydantic import Field

from nodeflow_sdk import BaseNode, FormField, FormGroup, NodeConfig, NodeContext, NodeForm, Output, node
from nodes.builtin._schemas import ANY_JSON_SCHEMA


class ManualTriggerConfig(NodeConfig):
    payload: dict = Field(default_factory=dict)


@node(
    id="manual.trigger",
    name="Manual Trigger",
    category="Triggers",
    description="Start a workflow manually.",
    group="trigger",
    icon="play",
    tags=["trigger"],
    keywords=["manual", "start", "run"],
    documentation_url="/docs/nodes/index.html#manual.trigger",
    form=NodeForm(
        groups=(
            FormGroup(
                "input",
                "初始数据",
                fields=(
                    FormField("payload", control="json", label="运行输入"),
                ),
            ),
        )
    ),
)
class ManualTriggerNode(BaseNode[ManualTriggerConfig]):
    effect = "pure"
    preview_support = "execute"
    outputs = {
        "success": Output(display_name="初始数据", description="Initial payload", schema=ANY_JSON_SCHEMA)
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        if ctx.data.get("has_initial_input"):
            return {"success": ctx.data.get("workflow_input")}
        return {"success": self.config.payload}
