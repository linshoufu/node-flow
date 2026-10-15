from typing import Literal

from pydantic import Field, field_validator

from nodeflow_sdk import BaseNode, FormField, FormGroup, Input, NodeConfig, NodeContext, NodeForm, Output, SelectOption, node
from nodes.builtin._schemas import ANY_JSON_SCHEMA


class WebhookTriggerConfig(NodeConfig):
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "POST"
    path: str = Field(..., min_length=1, max_length=200, pattern=r"^[A-Za-z0-9][A-Za-z0-9._~/-]*$")
    response_mode: Literal["sync", "immediate"] = "sync"
    credential_id: str | None = Field(default=None, min_length=1)


WEBHOOK_METHOD_OPTIONS = (
    SelectOption("GET", "GET"),
    SelectOption("POST", "POST"),
    SelectOption("PUT", "PUT"),
    SelectOption("PATCH", "PATCH"),
    SelectOption("DELETE", "DELETE"),
)

WEBHOOK_RESPONSE_MODE_OPTIONS = (
    SelectOption("sync", "等待工作流完成"),
    SelectOption("immediate", "立即确认，后台执行"),
)


@node(
    id="webhook.trigger",
    name="Webhook Trigger",
    category="Triggers",
    description="Start a workflow when an HTTP endpoint receives a request.",
    group="trigger",
    icon="webhook",
    tags=["trigger", "webhook", "http"],
    keywords=["webhook", "http", "trigger", "request"],
    documentation_url="/docs/nodes/index.html#webhook.trigger",
    form=NodeForm(
        groups=(
            FormGroup(
                "webhook",
                "触发配置",
                fields=(
                    FormField("method", control="select", label="请求方法", options=WEBHOOK_METHOD_OPTIONS),
                    FormField("path", label="请求路径", placeholder="orders/created", expression="disabled"),
                    FormField(
                        "response_mode",
                        control="select",
                        label="响应方式",
                        options=WEBHOOK_RESPONSE_MODE_OPTIONS,
                    ),
                ),
            ),
            FormGroup(
                "security",
                "访问保护",
                fields=(
                    FormField(
                        "credential_id",
                        control="credential",
                        label="验证请求头",
                        credential_type_ids=("http.header", "webhook.hmac_sha256"),
                    ),
                ),
            ),
        )
    ),
)
class WebhookTriggerNode(BaseNode[WebhookTriggerConfig]):
    effect = "pure"
    preview_support = "execute"
    outputs = {
        "success": Output(display_name="请求数据", description="Incoming request", schema=ANY_JSON_SCHEMA)
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": inputs}


class WebhookRespondConfig(NodeConfig):
    status_code: int = Field(default=200, ge=100, le=599)
    headers: dict[str, str] = Field(default_factory=dict)

    @field_validator("headers")
    @classmethod
    def validate_headers(cls, headers: dict[str, str]) -> dict[str, str]:
        for name, value in headers.items():
            if not name.strip() or "\r" in name or "\n" in name:
                raise ValueError("Response header names must be non-empty and cannot contain line breaks")
            if "\r" in value or "\n" in value:
                raise ValueError("Response header values cannot contain line breaks")
        return headers


@node(
    id="webhook.respond",
    name="Webhook Response",
    category="Triggers",
    description="Return a custom HTTP response for the current Webhook request.",
    group="action",
    icon="reply",
    tags=["webhook", "http", "response"],
    keywords=["webhook", "http", "response", "reply"],
    documentation_url="/docs/nodes/index.html#webhook.respond",
    form=NodeForm(
        groups=(
            FormGroup(
                "response",
                "响应",
                fields=(
                    FormField("status_code", control="number", label="响应状态码"),
                    FormField("headers", control="json", label="响应头"),
                ),
            ),
        )
    ),
)
class WebhookRespondNode(BaseNode[WebhookRespondConfig]):
    effect = "write"
    preview_support = "plan"

    async def preview(self, ctx: NodeContext, inputs: dict):
        from nodeflow_sdk import PlannedEffect, PreviewResult
        return PreviewResult(effects=(PlannedEffect("webhook_response", "caller", inputs, "仅计划响应，不发送业务响应"),))
    inputs = {
        "input": Input(display_name="响应内容", required=False, schema=ANY_JSON_SCHEMA)
    }
    outputs = {
        "success": Output(display_name="已响应", description="Response body", schema=ANY_JSON_SCHEMA)
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": inputs.get("input", {})}
