from pydantic import BaseModel, Field

from nodeflow_sdk import BaseNode, Input, NodeContext, Output, node


class ForEachConfig(BaseModel):
    items_expression: str = Field(..., title="Items expression")
    max_items: int = Field(default=100, ge=1, le=10000)
    continue_on_error: bool = False
    timeout_seconds: int = Field(default=300, ge=1, le=86400)


@node(
    id="control.foreach",
    name="For Each",
    category="Control",
    description="Run a body subflow for each item.",
)
class ForEachNode(BaseNode[ForEachConfig]):
    inputs = {"input": Input(required=False)}
    outputs = {
        "done": Output(description="All iterations completed"),
        "error": Output(description="Loop failed"),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"done": inputs}


class WhileConfig(BaseModel):
    condition: str = Field(..., title="Condition expression")
    max_iterations: int = Field(default=100, ge=1, le=10000)
    timeout_seconds: int = Field(default=300, ge=1, le=86400)


@node(
    id="control.while",
    name="While",
    category="Control",
    description="Run a body subflow while a condition is true.",
)
class WhileNode(BaseNode[WhileConfig]):
    inputs = {"input": Input(required=False)}
    outputs = {
        "done": Output(description="Condition became false"),
        "max_reached": Output(description="Maximum iterations reached"),
        "error": Output(description="Loop failed"),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"done": inputs}
