import asyncio
from typing import Any

from pydantic import Field

from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node


class TransformConfig(NodeConfig):
    value: Any = Field(default="", title="Value expression")


@node(
    id="utility.transform",
    name="Transform",
    category="Utility",
    description="Return a selected expression value.",
)
class TransformNode(BaseNode[TransformConfig]):
    inputs = {"input": Input(required=False)}
    outputs = {"success": Output(description="Transformed value")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": inputs}


class LogConfig(NodeConfig):
    message: str = Field(..., title="Message")


@node(id="utility.log", name="Log", category="Utility", description="Write a message into run logs.")
class LogNode(BaseNode[LogConfig]):
    inputs = {"input": Input(required=False)}
    outputs = {"success": Output(description="Input passthrough")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        ctx.log.info(self.config.message)
        return {"success": inputs}


class DelayConfig(NodeConfig):
    seconds: float = Field(default=1.0, ge=0.0, le=300.0)


@node(id="utility.delay", name="Delay", category="Utility", description="Wait before continuing.")
class DelayNode(BaseNode[DelayConfig]):
    inputs = {"input": Input(required=False)}
    outputs = {"success": Output(description="Input passthrough")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        await asyncio.sleep(self.config.seconds)
        return {"success": inputs}
