from nodeflow_sdk.parameters import RunParametersConfig, resolve_parameters


def parameter_declaration(workflow):
    declarations = []

    def visit(nodes, nested=False):
        for node in nodes:
            if node.type == "workflow.parameters":
                if nested:
                    raise ValueError("运行参数节点必须放在主流程")
                declarations.append(RunParametersConfig.model_validate(node.config))
            for subflow in node.subflows.values():
                visit(subflow.nodes, True)

    visit(workflow.nodes)
    if len(declarations) > 1:
        raise ValueError("每个工作流只能声明一个运行参数节点")
    return declarations[0] if declarations else None


def resolve_workflow_parameters(workflow, initial_input):
    declaration = parameter_declaration(workflow)
    return resolve_parameters(declaration, initial_input) if declaration else {}
