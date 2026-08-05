import tomllib
from pathlib import Path
from typing import Literal

import pytest
from pydantic import BaseModel, Field, ValidationError

from nodeflow_sdk import (
    BaseNode,
    Input,
    NODEFLOW_ENGINE_VERSION,
    NodeConfig,
    NodeContext,
    NodeMeta,
    Output,
    __version__,
    execution_item,
    node,
)
from nodes.builtin.logic import SetVariableNode
from nodes.builtin.utility import TransformNode


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


def test_sdk_engine_version_matches_project_version():
    project = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))

    assert __version__ == NODEFLOW_ENGINE_VERSION == project["project"]["version"]


def test_node_decorator_attaches_metadata():
    assert DemoNode.__node_meta__.id == "demo.node"
    assert DemoNode.__node_meta__.name == "Demo Node"
    assert DemoNode.__node_meta__.category == "Demo"
    assert DemoNode.__node_meta__.description == "A demo node."
    assert DemoNode.__node_meta__.display_name == "Demo Node"
    assert DemoNode.__node_meta__.group == "action"
    assert DemoNode.__node_meta__.icon is None
    assert DemoNode.__node_meta__.tags == ()
    assert DemoNode.__node_meta__.keywords == ()
    assert DemoNode.__node_meta__.documentation_url is None
    assert DemoNode.__node_meta__.version == 1
    assert isinstance(DemoNode.__node_meta__, NodeMeta)


def test_node_decorator_accepts_product_metadata():
    @node(
        id="demo.rich",
        name="Rich Node",
        category="Demo",
        description="A richer node.",
        display_name="Rich Display",
        group="trigger",
        icon="bolt",
        tags=["推荐", "HTTP"],
        keywords=["webhook", "api"],
        documentation_url="https://example.com/docs/rich",
        version=2,
    )
    class RichNode(BaseNode[DemoConfig]):
        pass

    assert RichNode.__node_meta__ == NodeMeta(
        id="demo.rich",
        name="Rich Node",
        category="Demo",
        description="A richer node.",
        display_name="Rich Display",
        group="trigger",
        icon="bolt",
        tags=("推荐", "HTTP"),
        keywords=("webhook", "api"),
        documentation_url="https://example.com/docs/rich",
        version=2,
    )


def test_input_and_output_serialize_to_dicts():
    assert Input(required=False, description="Body").to_dict() == {
        "required": False,
        "description": "Body",
    }
    assert Output(description="Done").to_dict() == {"description": "Done"}


def test_execution_item_builds_the_standard_item_envelope():
    assert execution_item(
        {"id": 1},
        binary={"attachment": {"mimeType": "text/plain"}},
        paired_item={"item": 0},
    ) == {
        "json": {"id": 1},
        "binary": {"attachment": {"mimeType": "text/plain"}},
        "pairedItem": {"item": 0},
    }



def test_input_and_output_serialize_optional_schemas():
    assert Input(required=False, description="Rows", schema={"type": "array"}).to_dict() == {
        "required": False,
        "description": "Rows",
        "schema": {"type": "array"},
    }
    assert Output(description="Response", schema={"type": "object"}).to_dict() == {
        "description": "Response",
        "schema": {"type": "object"},
    }


def test_input_serializes_multi_connection_contract():
    assert Input(
        required=False,
        description="Items",
        schema={"type": "array"},
        max_connections=None,
    ).to_dict() == {
        "required": False,
        "description": "Items",
        "schema": {"type": "array"},
        "maxConnections": None,
    }


def test_input_serializes_product_port_metadata():
    assert Input(
        required=False,
        description="Raw user payload",
        display_name="请求体",
        category="data",
        filter={"nodes": ["http.request"], "excludedNodes": ["debug.log"]},
        max_connections=None,
    ).to_dict() == {
        "required": False,
        "description": "Raw user payload",
        "displayName": "请求体",
        "category": "data",
        "filter": {"nodes": ["http.request"], "excludedNodes": ["debug.log"]},
        "maxConnections": None,
    }


def test_output_serializes_product_port_metadata():
    assert Output(
        description="Failure branch",
        display_name="错误",
        category="error",
        filter={"nodes": ["debug.log"]},
        max_connections=3,
    ).to_dict() == {
        "description": "Failure branch",
        "displayName": "错误",
        "category": "error",
        "filter": {"nodes": ["debug.log"]},
        "maxConnections": 3,
    }


def test_output_defaults_to_unlimited_connections_and_serializes_an_explicit_limit():
    assert Output().to_dict() == {"description": ""}
    assert Output(max_connections=1).to_dict() == {
        "description": "",
        "maxConnections": 1,
    }


def test_input_and_output_serialize_connection_kinds():
    assert Input(connection_kind="tool").to_dict() == {
        "required": True,
        "description": "",
        "connectionKind": "tool",
    }
    assert Output(connection_kind="resource").to_dict() == {
        "description": "",
        "connectionKind": "resource",
    }


def test_input_serializes_item_data_mode():
    assert Input(required=False, data_mode="items").to_dict() == {
        "required": False,
        "description": "",
        "dataMode": "items",
    }


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


def test_node_config_schema_rejects_additional_properties():
    assert NodeConfig.model_json_schema()["additionalProperties"] is False


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


@pytest.mark.asyncio
async def test_transform_node_returns_its_configured_value():
    node_instance = TransformNode(config={"value": {"result": "ready"}})

    result = await node_instance.execute(NodeContext(run_id="run_1", node_id="transform"), {"input": "ignored"})

    assert result == {"success": {"result": "ready"}}


@pytest.mark.asyncio
async def test_set_variable_node_updates_the_runtime_variable_context():
    ctx = NodeContext(
        run_id="run_1",
        node_id="set_answer",
        data={"inputs": {"input": {"answer": 42}}, "variables": {}},
    )
    node_instance = SetVariableNode(config={"name": "answer", "value": "{{ inputs.input.answer }}"})

    result = await node_instance.execute(ctx, {"input": {"answer": 42}})

    assert result == {"success": {"name": "answer", "value": 42, "variables": {"answer": 42}}}
    assert ctx.data["variables"] == {"answer": 42}


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
