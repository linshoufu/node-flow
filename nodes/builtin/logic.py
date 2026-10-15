from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from nodeflow_sdk import BaseNode, DynamicOutputList, FormField, FormGroup, Input, NodeConfig, NodeContext, NodeForm, Output, node
from nodeflow_sdk.expressions import resolve_expression
from nodes.builtin._schemas import ANY_JSON_SCHEMA


class IfConfig(NodeConfig):
    condition: str = Field(..., title="Condition expression")


@node(
    id="logic.if",
    name="If",
    category="Logic",
    description="Route execution by a truthy expression.",
    group="control",
    icon="git-branch",
    tags=["control", "branch"],
    keywords=["if", "condition", "true", "false", "route"],
    documentation_url="/docs/nodes/index.html#logic.if",
    form=NodeForm(
        groups=(
            FormGroup(
                "condition",
                "分支条件",
                fields=(
                    FormField(
                        "condition",
                        control="textarea",
                        label="分支条件",
                        placeholder="{{ inputs.input.enabled }}",
                        expression="required",
                    ),
                ),
            ),
        )
    ),
)
class IfNode(BaseNode[IfConfig]):
    effect = "pure"
    preview_support = "execute"
    inputs = {"input": Input(display_name="输入", required=False, schema=ANY_JSON_SCHEMA)}
    outputs = {
        "true": Output(display_name="为真", description="Condition is truthy", schema=ANY_JSON_SCHEMA),
        "false": Output(display_name="为假", description="Condition is falsey", schema=ANY_JSON_SCHEMA),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"true": inputs}


class SwitchRule(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    label: str = Field(min_length=1, max_length=80)
    value: Any = None

    @field_validator("id", "label")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return value.strip()


class SwitchConfig(NodeConfig):
    rules: list[SwitchRule] = Field(
        default=[
            {"id": "route_1", "label": "匹配值 1", "value": "value_1"},
            {"id": "route_2", "label": "匹配值 2", "value": "value_2"},
        ],
        min_length=1,
        max_length=12,
    )

    @model_validator(mode="after")
    def require_unique_route_ids(self) -> "SwitchConfig":
        route_ids = [rule.id for rule in self.rules]
        if len(route_ids) != len(set(route_ids)):
            raise ValueError("每条路由规则的端口标识必须唯一。")
        return self


@node(
    id="logic.switch",
    name="Switch",
    category="Logic",
    description="Route an input value to a configured matching output.",
    group="control",
    icon="git-fork",
    tags=["control", "branch", "switch"],
    keywords=["switch", "route", "branch", "match", "case"],
    documentation_url="/docs/nodes/index.html#logic.switch",
    dynamic_outputs=DynamicOutputList(
        config_key="rules",
        output=Output(description="Matched route input", schema=ANY_JSON_SCHEMA),
        default_items=(
            {"id": "route_1", "label": "匹配值 1", "value": "value_1"},
            {"id": "route_2", "label": "匹配值 2", "value": "value_2"},
        ),
    ),
    form=NodeForm(
        groups=(
            FormGroup(
                "routes",
                "路由规则",
                fields=(
                    FormField(
                        "rules",
                        control="dynamic_output_list",
                        label="路由规则",
                        description="为每条规则设置分支名称和匹配值；新增、删除或调整顺序会立即同步画布端口。",
                        expression="disabled",
                    ),
                ),
            ),
        )
    ),
)
class SwitchNode(BaseNode[SwitchConfig]):
    effect = "pure"
    preview_support = "execute"
    inputs = {"input": Input(display_name="输入", required=False, schema=ANY_JSON_SCHEMA)}
    outputs = {"fallback": Output(display_name="未匹配", description="No route matched", schema=ANY_JSON_SCHEMA)}

    @classmethod
    def output_ports(cls, config: dict[str, Any] | SwitchConfig | None = None) -> dict[str, Output]:
        parsed = config if isinstance(config, SwitchConfig) else SwitchConfig.model_validate(config or {})
        return {
            **{
                rule.id: Output(display_name=rule.label, description="Matched route input", schema=ANY_JSON_SCHEMA)
                for rule in parsed.rules
            },
            **cls.outputs,
        }

    async def execute(self, ctx: NodeContext, inputs: dict):
        value = inputs.get("input")
        for rule in self.config.rules:
            if value == rule.value:
                return {rule.id: inputs}
        return {"fallback": inputs}


class SetVariableConfig(NodeConfig):
    name: str = Field(..., title="Variable name")
    value: Any = Field(..., title="Value expression")


@node(
    id="logic.set_variable",
    name="Set Variable",
    category="Logic",
    description="Set a runtime variable.",
    group="action",
    icon="variable",
    tags=["variable", "data"],
    keywords=["set", "store", "runtime", "context"],
    documentation_url="/docs/nodes/index.html#logic.set_variable",
    form=NodeForm(
        groups=(
            FormGroup(
                "variable",
                "变量",
                fields=(
                    FormField("name", label="变量名称", placeholder="例如：access_token"),
                    FormField("value", control="textarea", label="变量值", placeholder="{{ inputs.input.token }}"),
                ),
            ),
        )
    ),
)
class SetVariableNode(BaseNode[SetVariableConfig]):
    effect = "pure"
    preview_support = "execute"
    resolve_config_expressions = False
    inputs = {"input": Input(display_name="输入", required=False, schema=ANY_JSON_SCHEMA)}
    outputs = {"success": Output(display_name="变量", description="Updated variables", schema=ANY_JSON_SCHEMA)}

    async def execute(self, ctx: NodeContext, inputs: dict):
        value = resolve_expression(self.config.value, ctx.data)
        variables = ctx.set_variable(self.config.name, value)
        return {"success": {"name": self.config.name, "value": value, "variables": variables}}
