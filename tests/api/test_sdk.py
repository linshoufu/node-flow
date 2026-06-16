from typing import Literal

import pytest
from pydantic import BaseModel, Field

from nodeflow_sdk import BaseNode, Input, NodeContext, Output, node


class DemoConfig(BaseModel):
    mode: Literal["fast", "safe"] = "fast"
    count: int = Field(default=1, ge=1)


@node(id="demo.node", name="Demo Node", category="Demo", description="A demo node.")
class DemoNode(BaseNode[DemoConfig]):
    inputs = {"input": Input(required=True)}
    outputs = {"success": Output(description="Successful output")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        ctx.log.info("running")
        return {"success": {"count": self.config.count, "input": inputs["input"]}}


def test_node_decorator_attaches_metadata():
    assert DemoNode.__node_meta__.id == "demo.node"
    assert DemoNode.__node_meta__.name == "Demo Node"
    assert DemoNode.__node_meta__.category == "Demo"


def test_base_node_extracts_config_model():
    assert DemoNode.config_model() is DemoConfig
    schema = DemoNode.config_schema()
    assert schema["properties"]["mode"]["enum"] == ["fast", "safe"]


@pytest.mark.asyncio
async def test_node_context_collects_logs():
    ctx = NodeContext(run_id="run_1", node_id="node_1")
    node_instance = DemoNode(config={"count": 2})
    result = await node_instance.execute(ctx, {"input": "hello"})
    assert result == {"success": {"count": 2, "input": "hello"}}
    assert ctx.logs[0]["level"] == "info"
    assert ctx.logs[0]["message"] == "running"
