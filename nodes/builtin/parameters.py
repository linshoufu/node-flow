from nodeflow_sdk import BaseNode, DynamicOutputList, FormField, FormGroup, Input, NodeContext, NodeForm, Output, node
from nodeflow_sdk.parameters import RunParametersConfig


@node(
    id="workflow.parameters", version=2, name="运行参数", category="Workflow", icon="settings",
    description="声明运行前填写和校验的参数；每个参数通过独立端口输出。",
    documentation_url="/docs/nodes/index.html#workflow.parameters",
    dynamic_outputs=DynamicOutputList(config_key="fields", id_key="name", label_key="label", output=Output(description="本次运行的参数值", schema={})),
    form=NodeForm(groups=(FormGroup("parameters", "运行参数", fields=(
        FormField("fields", control="parameter_list", label="参数定义", description="配置运行时的输入字段、默认值和可选项。"),
        FormField("input_path", label="输入对象路径", description="留空读取调用输入；Webhook 可填写 body。"),
    )),)),
)
class RunParametersNode(BaseNode[RunParametersConfig]):
    effect = "pure"
    preview_support = "execute"
    resolve_config_expressions = False
    inputs = {"input": Input(display_name="触发输入", required=False, schema={})}
    outputs = {}

    @classmethod
    def output_ports(cls, config=None):
        config = RunParametersConfig.model_validate(config or {})
        return {field.name: Output(display_name=field.label.strip() or None, description="本次运行的参数值", schema={}) for field in config.fields}

    @classmethod
    def migrate_config(cls, from_version, config):
        return dict(config)

    async def execute(self, ctx: NodeContext, inputs: dict):
        parameters = ctx.data["run_parameters"]
        return {field.name: parameters[field.name] for field in self.config.fields if field.name in parameters}
