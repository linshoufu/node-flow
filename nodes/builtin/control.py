from pydantic import Field

from nodeflow_sdk import BaseNode, FormField, FormGroup, Input, NodeConfig, NodeContext, NodeForm, Output, node
from nodes.builtin._schemas import ANY_JSON_SCHEMA, ERROR_SCHEMA


class ItemLoopConfig(NodeConfig):
    max_items: int = Field(default=100, ge=1, le=10000)
    continue_on_error: bool = False
    timeout_seconds: int = Field(default=300, ge=1, le=86400)


class ForEachConfig(ItemLoopConfig):
    items_expression: str = Field(..., title="Items expression")


@node(
    id="control.foreach",
    name="For Each",
    category="Control",
    description="Run a body subflow for each item.",
    group="control",
    icon="repeat",
    tags=["control", "loop", "data"],
    keywords=["foreach", "each", "iterate", "list", "array"],
    documentation_url="/docs/nodes/index.html#control.foreach",
    form=NodeForm(
        groups=(
            FormGroup(
                "items",
                "循环数据",
                fields=(
                    FormField(
                        "items_expression",
                        control="textarea",
                        label="循环数据表达式",
                        placeholder="{{ nodes.csv.outputs.success.rows }}",
                        expression="required",
                    ),
                ),
            ),
            FormGroup(
                "limits",
                "执行限制",
                fields=(
                    FormField("max_items", control="number", label="最多处理项"),
                    FormField("timeout_seconds", control="number", label="循环超时（秒）", expression="disabled"),
                ),
            ),
            FormGroup(
                "errors",
                "错误处理",
                fields=(
                    FormField("continue_on_error", control="switch", label="单项失败后继续"),
                ),
            ),
        )
    ),
)
class ForEachNode(BaseNode[ForEachConfig]):
    inputs = {"input": Input(display_name="循环输入", required=False, schema=ANY_JSON_SCHEMA)}
    outputs = {
        "done": Output(display_name="完成", description="All iterations completed", schema=ANY_JSON_SCHEMA),
        "error": Output(display_name="错误", category="error", description="Loop failed", schema=ERROR_SCHEMA),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"done": inputs}


@node(
    id="control.each_item",
    name="Each Item",
    category="Control",
    description="Run a body subflow for every incoming execution item.",
    group="action",
    icon="repeat",
    tags=["control", "loop", "items"],
    keywords=["each", "item", "iterate", "batch", "rows"],
    documentation_url="/docs/nodes/index.html#control.each_item",
    form=NodeForm(
        groups=(
            FormGroup(
                "limits",
                "执行限制",
                fields=(
                    FormField("max_items", control="number", label="最多处理项"),
                    FormField("timeout_seconds", control="number", label="循环超时（秒）", expression="disabled"),
                ),
            ),
            FormGroup(
                "errors",
                "错误处理",
                fields=(
                    FormField("continue_on_error", control="switch", label="单项失败后继续"),
                ),
            ),
        )
    ),
)
class EachItemNode(BaseNode[ItemLoopConfig]):
    inputs = {
        "items": Input(
            display_name="数据项",
            required=True,
            description="Execution items to process one by one",
            data_mode="items",
        )
    }
    outputs = {
        "done": Output(display_name="完成", description="All items completed", schema=ANY_JSON_SCHEMA),
        "error": Output(display_name="错误", category="error", description="Item loop failed", schema=ERROR_SCHEMA),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"done": inputs}


class WhileConfig(NodeConfig):
    condition: str = Field(..., title="Condition expression")
    max_iterations: int = Field(default=100, ge=1, le=10000)
    timeout_seconds: int = Field(default=300, ge=1, le=86400)


@node(
    id="control.while",
    name="While",
    category="Control",
    description="Run a body subflow while a condition is true.",
    group="control",
    icon="rotate-cw",
    tags=["control", "loop"],
    keywords=["while", "condition", "repeat", "iterate"],
    documentation_url="/docs/nodes/index.html#control.while",
    form=NodeForm(
        groups=(
            FormGroup(
                "condition",
                "循环条件",
                fields=(
                    FormField(
                        "condition",
                        control="textarea",
                        label="循环条件",
                        placeholder="{{ vars.should_continue }}",
                        expression="required",
                    ),
                ),
            ),
            FormGroup(
                "limits",
                "执行限制",
                fields=(
                    FormField("max_iterations", control="number", label="最大循环次数"),
                    FormField("timeout_seconds", control="number", label="循环超时（秒）", expression="disabled"),
                ),
            ),
        )
    ),
)
class WhileNode(BaseNode[WhileConfig]):
    inputs = {"input": Input(display_name="循环输入", required=False, schema=ANY_JSON_SCHEMA)}
    outputs = {
        "done": Output(display_name="完成", description="Condition became false", schema=ANY_JSON_SCHEMA),
        "max_reached": Output(display_name="达到上限", description="Maximum iterations reached", schema=ANY_JSON_SCHEMA),
        "error": Output(display_name="错误", category="error", description="Loop failed", schema=ERROR_SCHEMA),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"done": inputs}
