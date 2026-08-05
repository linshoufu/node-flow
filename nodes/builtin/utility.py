import asyncio
from typing import Any

from pydantic import Field

from nodeflow_sdk import BaseNode, FormField, FormGroup, Input, NodeConfig, NodeContext, NodeForm, Output, node
from nodes.builtin._schemas import ANY_JSON_SCHEMA


class TransformConfig(NodeConfig):
    value: Any = Field(default="", title="Value expression")


@node(
    id="utility.transform",
    name="Transform",
    category="Utility",
    description="Return a selected expression value.",
    group="action",
    icon="wand",
    tags=["utility", "data"],
    keywords=["transform", "map", "expression", "value"],
    documentation_url="/docs/nodes/index.html#utility.transform",
    form=NodeForm(
        groups=(
            FormGroup(
                "transform",
                "转换",
                fields=(
                    FormField("value", control="textarea", label="转换结果", placeholder="{{ inputs.input }}"),
                ),
            ),
        )
    ),
)
class TransformNode(BaseNode[TransformConfig]):
    inputs = {"input": Input(display_name="输入", required=False, schema=ANY_JSON_SCHEMA)}
    outputs = {"success": Output(display_name="转换结果", description="Transformed value", schema=ANY_JSON_SCHEMA)}

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": self.config.value}


class LogConfig(NodeConfig):
    message: str = Field(..., title="Message")


@node(
    id="utility.log",
    name="Log",
    category="Utility",
    description="Write a message into run logs.",
    group="action",
    icon="file-text",
    tags=["utility", "debug"],
    keywords=["log", "message", "inspect", "debug"],
    documentation_url="/docs/nodes/index.html#utility.log",
    form=NodeForm(
        groups=(
            FormGroup(
                "message",
                "日志",
                fields=(
                    FormField("message", control="textarea", label="日志内容", placeholder="处理完成：{{ inputs.input }}"),
                ),
            ),
        )
    ),
)
class LogNode(BaseNode[LogConfig]):
    inputs = {"input": Input(display_name="输入", required=False, schema=ANY_JSON_SCHEMA)}
    outputs = {"success": Output(display_name="继续", description="Input passthrough", schema=ANY_JSON_SCHEMA)}

    async def execute(self, ctx: NodeContext, inputs: dict):
        ctx.log.info(self.config.message)
        return {"success": inputs}


class DelayConfig(NodeConfig):
    seconds: float = Field(default=1.0, ge=0.0, le=300.0)


@node(
    id="utility.delay",
    name="Delay",
    category="Utility",
    description="Wait before continuing.",
    group="action",
    icon="clock",
    tags=["utility"],
    keywords=["wait", "sleep", "pause", "timer"],
    documentation_url="/docs/nodes/index.html#utility.delay",
    form=NodeForm(
        groups=(
            FormGroup(
                "delay",
                "等待",
                fields=(
                    FormField("seconds", control="number", label="等待秒数", expression="disabled"),
                ),
            ),
        )
    ),
)
class DelayNode(BaseNode[DelayConfig]):
    inputs = {"input": Input(display_name="输入", required=False, schema=ANY_JSON_SCHEMA)}
    outputs = {"success": Output(display_name="继续", description="Input passthrough", schema=ANY_JSON_SCHEMA)}

    async def execute(self, ctx: NodeContext, inputs: dict):
        await asyncio.sleep(self.config.seconds)
        return {"success": inputs}
