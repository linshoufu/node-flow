"""演示节点：展示多种表单控件类型和内联卡片渲染。"""

from typing import Any, Literal

from pydantic import Field

from nodeflow_sdk import (
    BaseNode,
    FormField,
    FormGroup,
    Input,
    NodeConfig,
    NodeContext,
    NodeForm,
    Output,
    SelectOption,
    node,
)


class DemoConfig(NodeConfig):
    """演示配置模型：覆盖 text / number / switch / select / textarea / url 六种控件。"""

    title: str = Field(default="默认标题", title="标题", max_length=60)
    target_url: str = Field(default="https://example.com/api", title="目标地址")
    retry_count: int = Field(default=3, ge=0, le=10, title="重试次数")
    enable_notify: bool = Field(default=True, title="开启通知")
    notify_method: Literal["email", "webhook", "sms"] = Field(
        default="email", title="通知方式"
    )
    remarks: str = Field(default="", title="备注说明", max_length=500)


@node(
    id="demo.test",
    name="演示节点",
    category="测试",
    description="一个用于测试表单编辑器和内联控件的演示节点，含六种常用控件。",
    group="action",
    icon="flask-conical",
    tags=["demo", "test", "示例"],
    keywords=["演示", "测试", "demo"],
    documentation_url="/docs/nodes/index.html#demo.test",
    form=NodeForm(
        groups=(
            FormGroup(
                "basic",
                "基础配置",
                fields=(
                    FormField("title", control="text", label="标题", placeholder="输入任务标题"),
                    FormField("target_url", control="url", label="目标地址", placeholder="https://...", placement="inline"),
                    FormField("retry_count", control="number", label="重试次数"),
                    FormField("enable_notify", control="switch", label="开启通知", placement="inline"),
                    FormField(
                        "notify_method",
                        control="select",
                        label="通知方式",
                        options=(
                            SelectOption("email", "邮件通知"),
                            SelectOption("webhook", "Webhook"),
                            SelectOption("sms", "短信通知"),
                        ),
                        placement="inline",
                    ),
                    FormField("remarks", control="textarea", label="备注说明", placeholder="可选备注..."),
                ),
            ),
        )
    ),
)
class DemoNode(BaseNode[DemoConfig]):
    inputs = {
        "data": Input(display_name="输入数据", required=False, schema={"type": "object"}),
    }
    outputs = {
        "success": Output(display_name="输出", description="处理结果", schema={"type": "object"}),
        "error": Output(display_name="错误", description="出错时走此端口", schema={"type": "object"}),
    }

    async def execute(self, ctx: NodeContext, inputs: dict[str, Any]) -> dict[str, Any]:
        ctx.log.info(f"[DemoNode] title={self.config.title}, url={self.config.target_url}")
        return {"success": {"status": "ok", "title": self.config.title}}
