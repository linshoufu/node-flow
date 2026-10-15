from typing import Any

from pydantic import Field

from nodeflow_sdk import BaseNode, FormField, FormGroup, Input, NodeConfig, NodeContext, NodeForm, Output, node
from nodes.builtin._schemas import ANY_JSON_SCHEMA, ERROR_SCHEMA


class ExecuteWorkflowConfig(NodeConfig):
    workflow_id: str = Field(..., min_length=1, title="Target workflow")


@node(
    id="workflow.trigger",
    name="Workflow Trigger",
    category="Workflow",
    description="Receive input when another workflow calls this workflow.",
    group="trigger",
    icon="git-branch",
    tags=["workflow", "trigger"],
    keywords=["workflow", "input", "subworkflow"],
    documentation_url="/docs/nodes/index.html#workflow.trigger",
)
class WorkflowTriggerNode(BaseNode[NodeConfig]):
    effect = "pure"
    preview_support = "execute"
    outputs = {
        "success": Output(display_name="输入", description="Caller input", schema=ANY_JSON_SCHEMA)
    }

    async def execute(self, ctx: NodeContext, inputs: dict[str, Any]) -> dict[str, Any]:
        return {"success": inputs}


@node(
    id="workflow.execute",
    name="Execute Workflow",
    category="Workflow",
    description="Run a saved workflow and wait for its result.",
    group="action",
    icon="workflow",
    tags=["workflow", "subworkflow"],
    keywords=["workflow", "execute", "call", "subworkflow"],
    documentation_url="/docs/nodes/index.html#workflow.execute",
    form=NodeForm(
        groups=(
            FormGroup(
                "target",
                "目标工作流",
                fields=(
                    FormField("workflow_id", label="目标工作流"),
                ),
            ),
        )
    ),
)
class ExecuteWorkflowNode(BaseNode[ExecuteWorkflowConfig]):
    effect = "pure"
    preview_support = "execute"
    inputs = {"input": Input(display_name="输入", required=False, schema=ANY_JSON_SCHEMA)}
    outputs = {
        "success": Output(display_name="结果", description="Child workflow result", schema=ANY_JSON_SCHEMA),
        "error": Output(
            display_name="错误",
            description="Child workflow error",
            category="error",
            schema=ERROR_SCHEMA,
        ),
    }

    async def execute(self, ctx: NodeContext, inputs: dict[str, Any]) -> dict[str, Any]:
        return {"success": inputs.get("input", {})}


@node(
    id="workflow.return",
    name="End / Output",
    category="Workflow",
    description="Set the final workflow output and mark the intended end of the flow.",
    group="action",
    icon="corner-down-left",
    tags=["workflow", "return", "end", "output"],
    keywords=["workflow", "return", "result", "subworkflow", "end", "finish", "output"],
    documentation_url="/docs/nodes/index.html#workflow.return",
)
class WorkflowReturnNode(BaseNode[NodeConfig]):
    effect = "pure"
    preview_support = "execute"
    inputs = {"input": Input(display_name="最终结果", required=False, schema=ANY_JSON_SCHEMA)}
    outputs = {
        "success": Output(display_name="完成", description="Final workflow output", schema=ANY_JSON_SCHEMA)
    }

    async def execute(self, ctx: NodeContext, inputs: dict[str, Any]) -> dict[str, Any]:
        return {"success": inputs.get("input", {})}
