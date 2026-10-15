from pydantic import Field

from nodeflow_sdk import BaseNode, FormField, FormGroup, Input, NodeConfig, NodeContext, NodeForm, Output, node
from nodes.builtin._schemas import ANY_JSON_SCHEMA, ERROR_SCHEMA
from nodeflow_sdk.loops import LOOP_RESULTS_SCHEMA


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
    effect = "pure"
    preview_support = "execute"
    inputs = {"input": Input(display_name="循环输入", required=False, schema=ANY_JSON_SCHEMA)}
    outputs = {
        "done": Output(display_name="完成", description="All iterations completed", schema=ANY_JSON_SCHEMA),
        "results": Output(display_name="逐项结果", description="循环结果节点返回的值及每项状态", schema=LOOP_RESULTS_SCHEMA),
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
    effect = "pure"
    preview_support = "execute"
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
        "results": Output(display_name="逐项结果", description="循环结果节点返回的值及每项状态", schema=LOOP_RESULTS_SCHEMA),
        "error": Output(display_name="错误", category="error", description="Item loop failed", schema=ERROR_SCHEMA),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"done": inputs}


@node(id="control.loop_input", name="循环输入", category="Control", group="control", icon="log-in",
      description="显式输出当前循环的数据项。放在逐项循环体中使用。",
      documentation_url="/docs/nodes/index.html#control.loop_input")
class LoopInputNode(BaseNode[NodeConfig]):
    effect = "pure"
    preview_support = "execute"
    inputs = {}
    outputs = {"item": Output(display_name="当前数据项", schema=ANY_JSON_SCHEMA)}

    async def execute(self, ctx: NodeContext, inputs: dict):
        loop = ctx.data.get("loop")
        if not isinstance(loop, dict) or "item" not in loop:
            raise ValueError("循环输入只能在逐项循环体中使用")
        return {"item": loop["item"]}


@node(id="control.loop_output", name="循环结果", category="Control", group="control", icon="log-out",
      description="把本项处理结果交回逐项循环；循环通过逐项结果端口汇总输出。",
      documentation_url="/docs/nodes/index.html#control.loop_output")
class LoopOutputNode(BaseNode[NodeConfig]):
    effect = "pure"
    preview_support = "execute"
    inputs = {"value": Input(display_name="本项结果", schema=ANY_JSON_SCHEMA)}
    outputs = {"success": Output(display_name="本项结果", schema=ANY_JSON_SCHEMA)}

    async def execute(self, ctx: NodeContext, inputs: dict):
        loop = ctx.data.get("loop")
        if not isinstance(loop, dict) or "item" not in loop:
            raise ValueError("循环结果只能在逐项循环体中使用")
        return {"success": inputs["value"]}


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
    effect = "pure"
    preview_support = "execute"
    inputs = {"input": Input(display_name="循环输入", required=False, schema=ANY_JSON_SCHEMA)}
    outputs = {
        "done": Output(display_name="完成", description="Condition became false", schema=ANY_JSON_SCHEMA),
        "max_reached": Output(display_name="达到上限", description="Maximum iterations reached", schema=ANY_JSON_SCHEMA),
        "error": Output(display_name="错误", category="error", description="Loop failed", schema=ERROR_SCHEMA),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"done": inputs}
