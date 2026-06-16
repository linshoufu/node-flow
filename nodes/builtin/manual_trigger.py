from pydantic import BaseModel

from nodeflow_sdk import BaseNode, NodeContext, Output, node


class ManualTriggerConfig(BaseModel):
    payload: dict = {}


@node(
    id="manual.trigger",
    name="Manual Trigger",
    category="Triggers",
    description="Start a workflow manually.",
)
class ManualTriggerNode(BaseNode[ManualTriggerConfig]):
    outputs = {"success": Output(description="Initial payload")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": self.config.payload}
