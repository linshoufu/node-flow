"""User-owned reusable assets; package templates remain read-only."""
from copy import deepcopy
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field
from nodeflow_sdk.non_secret import assert_non_secret
from nodeflow_sdk.parameters import RunParameter, RunParametersConfig
from .schemas import WorkflowDocument, WorkflowNode, WorkflowSubflow
from .config_bindings import resolve_workflow_bindings
from .workflow_node_validation import node_definition_issues
from .workflow_connections import validate_workflow_connections


class TemplateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=1000)
    kind: Literal["node", "subflow", "workflow"]
    node: WorkflowNode | None = None
    graph: WorkflowSubflow | None = None
    workflow: WorkflowDocument | None = None
    configuration: list[RunParameter] = Field(default_factory=list)
    parameters: list[RunParameter] = Field(default_factory=list)
    variables: dict[str, Any] = Field(default_factory=dict)


class TemplateUpdate(TemplateCreate):
    expected_revision: int = Field(ge=1)


class TemplateRename(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=1000)
    expected_revision: int = Field(ge=1)


def prepare_user_template(request, registry):
    name = request.name.strip()
    if not name:
        raise ValueError("请输入名称")
    if sum(value is not None for value in (request.node, request.graph, request.workflow)) != 1 or getattr(request, {"node": "node", "subflow": "graph", "workflow": "workflow"}[request.kind]) is None:
        raise ValueError("请选择与资源类型匹配的节点或流程")
    if request.kind == "workflow":
        document = request.workflow.model_copy(deep=True)
    else:
        graph = request.graph or WorkflowSubflow(nodes=[request.node], edges=[])
        document = WorkflowDocument(id="template", name=name, nodes=deepcopy(graph.nodes), edges=deepcopy(graph.edges), settings={"configuration": request.configuration, "variables": request.variables})
        parameters = RunParametersConfig(fields=request.parameters)
        parameters.fields = [field.model_copy(update={"label": field.label or field.name}) for field in parameters.fields]
        if parameters.fields and not any(node.type == "workflow.parameters" for node in document.nodes):
            document.nodes.append(WorkflowNode(id=f"declaration_{uuid4().hex}", type="workflow.parameters", typeVersion=2, position={"x": 0, "y": 0}, config=parameters.model_dump()))
    if not document.nodes:
        raise ValueError("不能保存空白模板")
    def clean(nodes):
        for node in nodes:
            node.pinnedData = None
            assert_non_secret(node.config)
            for body in node.subflows.values():
                clean(body.nodes)
    clean(document.nodes)
    bound = resolve_workflow_bindings(document, registry)
    def check(nodes, edges, nested=False):
        if len({node.id for node in nodes}) != len(nodes) or len({edge.id for edge in edges}) != len(edges):
            raise ValueError("节点或连线 ID 重复")
        for node in nodes:
            if (nested or request.kind == "subflow") and node.type == "workflow.parameters":
                raise ValueError("运行参数只能在主流程声明")
            issues = node_definition_issues(node, registry, f"nodes.{node.id}")
            if issues:
                raise ValueError(issues[0][1])
            for body in node.subflows.values():
                check(body.nodes, body.edges, True)
        issues = validate_workflow_connections(edges, {node.id: node for node in nodes}, registry)
        if issues:
            raise ValueError(issues[0].message)
    check(bound.nodes, bound.edges)
    assert_non_secret(document.settings.variables)
    result = {"id": f"user_{uuid4().hex}", "source": "user", "packageId": "user", "packageVersion": "1", "name": name, "description": request.description.strip(), "kind": request.kind}
    if request.kind == "workflow":
        document.active = False
        document.version = 1
        document.settings.run_mode = "preview"
        document.settings.error_workflow_id = None
        result["workflow"] = document.model_dump(exclude_none=True)
    else:
        # Remove the temporary declaration used only to validate parameter references.
        count = len(request.graph.nodes) if request.graph else 1
        nodes = document.nodes[:count]
        result["node" if request.kind == "node" else "graph"] = nodes[0].model_dump(exclude_none=True) if request.kind == "node" else {"nodes": [node.model_dump(exclude_none=True) for node in nodes], "edges": [edge.model_dump() for edge in document.edges], "annotations": [item.model_dump() for item in request.graph.annotations]}
        result["configuration"] = [field.model_dump(exclude_none=True) for field in document.settings.configuration]
        result["parameters"] = [field.model_dump(exclude_none=True) for field in request.parameters]
        result["variables"] = document.settings.variables
    return result
