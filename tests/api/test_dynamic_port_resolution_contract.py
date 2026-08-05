from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.node_ports import (
    resolve_input_port_contract,
    resolve_output_port_contract,
)
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowNode
from apps.api.nodeflow_api.validation import validate_workflow


def build_dynamic_registry(tmp_path: Path) -> NodeRegistry:
    (tmp_path / "dynamic_contract.py").write_text(
        '''
from typing import Any

from pydantic import Field

from nodeflow_sdk import (
    BaseNode,
    DynamicInputList,
    DynamicOutputList,
    Input,
    NodeConfig,
    NodeContext,
    Output,
    node,
)


class DynamicOutputConfig(NodeConfig):
    rules: list[dict[str, str]] = Field(
        default_factory=lambda: [{"id": "route", "label": "Route"}]
    )
    mode: str = "ok"


@node(
    id="example.dynamic_output_contract",
    name="Dynamic Output Contract",
    category="Example",
    dynamic_outputs=DynamicOutputList(
        config_key="rules",
        output=Output(description="Dynamic output"),
    ),
)
class DynamicOutputContractNode(BaseNode[DynamicOutputConfig]):
    outputs = {"fallback": Output(description="Fallback")}

    @classmethod
    def output_ports(
        cls,
        config: dict[str, Any] | DynamicOutputConfig | None = None,
    ) -> dict[str, Output]:
        parsed = (
            config
            if isinstance(config, DynamicOutputConfig)
            else DynamicOutputConfig.model_validate(config or {})
        )
        route = parsed.rules[0]
        dynamic = Output(
            display_name=route["label"],
            description="Dynamic output",
        )
        if parsed.mode == "explode":
            raise RuntimeError("resolver exploded")
        if parsed.mode == "invalid_handle":
            return {**cls.outputs, "bad-handle": dynamic}
        if parsed.mode == "wrong_type":
            return {**cls.outputs, route["id"]: Input()}
        if parsed.mode == "missing_static":
            return {route["id"]: dynamic}
        if parsed.mode == "undeclared":
            return {**cls.outputs, route["id"]: dynamic, "extra": Output()}
        if parsed.mode == "metadata_drift":
            return {
                **cls.outputs,
                route["id"]: Output(
                    display_name=route["label"],
                    description="Different runtime metadata",
                ),
            }
        return {**cls.outputs, route["id"]: dynamic}

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"fallback": inputs}


class DynamicInputConfig(NodeConfig):
    sources: list[dict[str, str]] = Field(
        default_factory=lambda: [{"id": "source", "label": "Source"}]
    )


@node(
    id="example.dynamic_input_contract",
    name="Dynamic Input Contract",
    category="Example",
    dynamic_inputs=DynamicInputList(
        config_key="sources",
        input=Input(required=True, description="Dynamic input"),
    ),
)
class DynamicInputContractNode(BaseNode[DynamicInputConfig]):
    inputs = {"control": Input(required=False, description="Control")}
    outputs = {"success": Output()}

    @classmethod
    def input_ports(
        cls,
        config: dict[str, Any] | DynamicInputConfig | None = None,
    ) -> dict[str, Input]:
        raise RuntimeError("input resolver exploded")

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": inputs}
'''.lstrip(),
        encoding="utf-8",
    )
    registry = NodeRegistry(nodes_dir=tmp_path)
    registry.scan()
    assert registry.scan_result.diagnostics == ()
    return registry


@pytest.fixture
def dynamic_registry(tmp_path: Path) -> NodeRegistry:
    return build_dynamic_registry(tmp_path)


def output_node(mode: str) -> WorkflowNode:
    return WorkflowNode(
        id="dynamic_output",
        type="example.dynamic_output_contract",
        position=Position(x=0, y=0),
        config={
            "rules": [{"id": "route", "label": "Route"}],
            "mode": mode,
        },
    )


def test_valid_dynamic_resolver_matches_editor_contract(dynamic_registry: NodeRegistry):
    node = output_node("ok")

    result = resolve_output_port_contract(node, dynamic_registry.get(node.type))

    assert result.issue is None
    assert result.ports == {
        "fallback": {"description": "Fallback"},
        "route": {"description": "Dynamic output", "displayName": "Route"},
    }


def test_dynamic_resolver_uses_config_model_defaults(dynamic_registry: NodeRegistry):
    node = WorkflowNode(
        id="dynamic_output",
        type="example.dynamic_output_contract",
        position=Position(x=0, y=0),
        config={},
    )

    result = resolve_output_port_contract(node, dynamic_registry.get(node.type))

    assert result.issue is None
    assert set(result.ports) == {"fallback", "route"}


@pytest.mark.parametrize(
    ("mode", "message_fragment"),
    [
        ("explode", "RuntimeError"),
        ("invalid_handle", "bad-handle"),
        ("wrong_type", "必须使用 Output"),
        ("missing_static", "遗漏了已声明端口"),
        ("undeclared", "返回了未声明端口"),
        ("metadata_drift", "运行时定义与声明不一致"),
    ],
)
def test_invalid_dynamic_output_resolvers_fall_back_and_report_diagnostics(
    dynamic_registry: NodeRegistry,
    mode: str,
    message_fragment: str,
):
    node = output_node(mode)

    result = resolve_output_port_contract(node, dynamic_registry.get(node.type))

    assert result.ports == {"fallback": {"description": "Fallback"}}
    assert result.issue is not None
    assert result.issue.code == "node_output_port_resolution_failed"
    assert message_fragment in result.issue.message


def test_workflow_validation_exposes_dynamic_resolver_error_code(dynamic_registry: NodeRegistry):
    node = output_node("explode")

    result = validate_workflow(
        WorkflowDocument(id="resolver_failure", name="Resolver failure", nodes=[node]),
        dynamic_registry,
    )

    issue = next(issue for issue in result.issues if issue.code == "node_output_port_resolution_failed")
    assert result.valid is False
    assert issue.path == "nodes.dynamic_output.ports.outputs"
    assert "节点输出端口解析失败" in issue.message


def test_dynamic_input_resolver_failure_is_isolated(dynamic_registry: NodeRegistry):
    node = WorkflowNode(
        id="dynamic_input",
        type="example.dynamic_input_contract",
        position=Position(x=0, y=0),
        config={"sources": [{"id": "source", "label": "Source"}]},
    )

    result = resolve_input_port_contract(node, dynamic_registry.get(node.type))

    assert result.ports == {
        "control": {
            "required": False,
            "description": "Control",
        }
    }
    assert result.issue is not None
    assert result.issue.code == "node_input_port_resolution_failed"
    assert "RuntimeError" in result.issue.message


def test_api_rejects_faulty_dynamic_resolver_without_losing_health(tmp_path: Path):
    registry = build_dynamic_registry(tmp_path)
    assert registry.has("example.dynamic_output_contract")
    workflow = WorkflowDocument(
        id="resolver_api_failure",
        name="Resolver API failure",
        nodes=[output_node("explode")],
    )

    with TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path)) as client:
        validation_response = client.post(
            "/api/workflows/validate",
            json=workflow.model_dump(mode="json"),
        )
        save_response = client.post(
            "/api/workflows",
            json=workflow.model_dump(mode="json"),
        )
        health_response = client.get("/api/health")

    assert validation_response.status_code == 200
    assert validation_response.json()["valid"] is False
    assert any(
        issue["code"] == "node_output_port_resolution_failed"
        for issue in validation_response.json()["issues"]
    )
    assert save_response.status_code == 422
    assert any(
        issue["code"] == "node_output_port_resolution_failed"
        for issue in save_response.json()["detail"]
    )
    assert health_response.status_code == 200
    assert health_response.json() == {"status": "ok"}
