from pydantic import Field

from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node


class IfConfig(NodeConfig):
    condition: str = Field(..., title="Condition expression")


@node(id="logic.if", name="If", category="Logic", description="Route execution by a truthy expression.")
class IfNode(BaseNode[IfConfig]):
    inputs = {"input": Input(required=False)}
    outputs = {
        "true": Output(description="Condition is truthy"),
        "false": Output(description="Condition is falsey"),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"true": inputs}


class SetVariableConfig(NodeConfig):
    name: str = Field(..., title="Variable name")
    value: str = Field(..., title="Value expression")


@node(
    id="logic.set_variable",
    name="Set Variable",
    category="Logic",
    description="Set a runtime variable.",
)
class SetVariableNode(BaseNode[SetVariableConfig]):
    inputs = {"input": Input(required=False)}
    outputs = {"success": Output(description="Updated variables")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": inputs}
