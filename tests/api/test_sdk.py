from typing import Literal

import pytest
from pydantic import BaseModel, Field, ValidationError

from nodeflow_sdk import BaseNode, Input, NodeContext, NodeMeta, Output, node


class DemoConfig(BaseModel):
    mode: Literal["fast", "safe"] = "fast"
    count: int = Field(default=1, ge=1)


class RequiredConfig(BaseModel):
    name: str


@node(id="demo.node", name="Demo Node", category="Demo", description="A demo node.")
class DemoNode(BaseNode[DemoConfig]):
    inputs = {"input": Input(required=True)}
    outputs = {"success": Output(description="Successful output")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        ctx.log.info("running")
        return {"success": {"count": self.config.count, "input": inputs["input"]}}


class RequiredNode(BaseNode[RequiredConfig]):
    pass


class EmptyNode(BaseNode):
    pass


def test_node_decorator_attaches_metadata():
    assert DemoNode.__node_meta__.id == "demo.node"
    assert DemoNode.__node_meta__.name == "Demo Node"
    assert DemoNode.__node_meta__.category == "Demo"
    assert DemoNode.__node_meta__.description == "A demo node."
    assert isinstance(DemoNode.__node_meta__, NodeMeta)


def test_input_and_output_serialize_to_dicts():
    assert Input(required=False, description="Body").to_dict() == {
        "required": False,
        "description": "Body",
    }
    assert Output(description="Done").to_dict() == {"description": "Done"}


def test_base_node_extracts_config_model():
    assert DemoNode.config_model() is DemoConfig
    schema = DemoNode.config_schema()
    assert schema["properties"]["mode"]["enum"] == ["fast", "safe"]


def test_base_node_rejects_invalid_config_constraints():
    with pytest.raises(ValidationError):
        DemoNode(config={"count": 0})


def test_base_node_rejects_extra_config_keys():
    with pytest.raises(ValidationError):
        DemoNode(config={"count": 1, "typo": True})


def test_base_node_rejects_missing_required_config_fields():
    with pytest.raises(ValidationError):
        RequiredNode(config={})


def test_empty_config_node_rejects_extra_keys():
    with pytest.raises(ValidationError):
        EmptyNode(config={"typo": True})


@pytest.mark.asyncio
async def test_node_context_collects_logs():
    ctx = NodeContext(run_id="run_1", node_id="node_1")
    node_instance = DemoNode(config={"count": 2})
    result = await node_instance.execute(ctx, {"input": "hello"})
    assert result == {"success": {"count": 2, "input": "hello"}}
    assert ctx.logs[0]["level"] == "info"
    assert ctx.logs[0]["message"] == "running"
    assert "timestamp" in ctx.logs[0]
    assert ctx.logs[0]["fields"] == {}


def test_node_context_exposes_initial_state():
    ctx = NodeContext(run_id="run_1", node_id="node_1", scope=["workspace"])

    assert ctx.run_id == "run_1"
    assert ctx.node_id == "node_1"
    assert ctx.scope == ["workspace"]
    assert ctx.cancelled is False
    assert ctx.progress is None


def test_node_context_clamps_progress():
    ctx = NodeContext(run_id="run_1", node_id="node_1")

    ctx.emit_progress(-0.5)
    assert ctx.progress == 0.0

    ctx.emit_progress(0.4)
    assert ctx.progress == 0.4

    ctx.emit_progress(1.5)
    assert ctx.progress == 1.0


def test_node_context_returns_configured_secrets():
    ctx = NodeContext(
        run_id="run_1",
        node_id="node_1",
        secrets={"api_key": "secret_value"},
    )

    assert ctx.get_secret("api_key") == "secret_value"
    assert ctx.get_secret("missing") is None


def test_node_logger_collects_warning_and_error_logs():
    ctx = NodeContext(run_id="run_1", node_id="node_1")

    ctx.log.warning("careful", code="W1")
    ctx.log.error("failed", code="E1")

    assert ctx.logs[0]["level"] == "warning"
    assert ctx.logs[0]["message"] == "careful"
    assert ctx.logs[0]["fields"] == {"code": "W1"}
    assert "timestamp" in ctx.logs[0]
    assert ctx.logs[1]["level"] == "error"
    assert ctx.logs[1]["message"] == "failed"
