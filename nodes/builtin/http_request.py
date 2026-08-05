import base64
from typing import Any, Literal

import httpx
from pydantic import Field, ConfigDict

from nodeflow_sdk import (
    BaseNode,
    FormCondition,
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
from nodes.builtin._schemas import ANY_JSON_SCHEMA, ERROR_SCHEMA, HTTP_RESPONSE_SCHEMA, STRING_MAP_SCHEMA


class HttpRequestConfig(NodeConfig):
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "GET"
    url: str = Field(..., title="URL")
    headers: dict[str, str] = Field(default_factory=dict, title="Headers")
    credential_id: str | None = Field(default=None, title="Credential")
    body: Any = Field(default=None, title="Body")
    timeout_seconds: int = Field(default=30, ge=1, le=300)


HTTP_METHOD_OPTIONS = (
    SelectOption("GET", "GET"),
    SelectOption("POST", "POST"),
    SelectOption("PUT", "PUT"),
    SelectOption("PATCH", "PATCH"),
    SelectOption("DELETE", "DELETE"),
)
HTTP_METHODS_WITH_BODY = FormCondition("method", one_of=("POST", "PUT", "PATCH"))
HTTP_CREDENTIAL_TYPE_IDS = ("http.bearer", "http.basic", "http.header")


@node(
    id="http.request",
    name="HTTP Request",
    category="Network",
    description="Send an HTTP request.",
    group="action",
    icon="globe",
    tags=["http", "api", "network"],
    keywords=["request", "rest", "url", "web"],
    documentation_url="/docs/nodes/index.html#http.request",
    form=NodeForm(
        groups=(
            FormGroup(
                "request",
                "请求",
                fields=(
                    FormField("method", control="select", label="请求方法", options=HTTP_METHOD_OPTIONS),
                    FormField("url", control="url", label="URL", placeholder="https://api.example.com/users"),
                    FormField("timeout_seconds", control="number", label="超时（秒）"),
                ),
            ),
            FormGroup(
                "content",
                "内容",
                fields=(
                    FormField("body", control="json", label="请求体", visible_when=HTTP_METHODS_WITH_BODY),
                    FormField("headers", control="json", label="请求头"),
                ),
            ),
            FormGroup(
                "authentication",
                "认证",
                fields=(
                    FormField(
                        "credential_id",
                        control="credential",
                        label="认证凭据",
                        credential_type_ids=HTTP_CREDENTIAL_TYPE_IDS,
                    ),
                ),
            ),
        )
    ),
)
class HttpRequestNode(BaseNode[HttpRequestConfig]):
    inputs = {
        "body": Input(display_name="请求体", required=False, description="Request body", schema=ANY_JSON_SCHEMA),
        "headers": Input(display_name="请求头", required=False, description="Request headers", schema=STRING_MAP_SCHEMA),
    }
    outputs = {
        "success": Output(display_name="响应", description="Response data", schema=HTTP_RESPONSE_SCHEMA),
        "error": Output(display_name="错误", category="error", description="Request error", schema=ERROR_SCHEMA),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        credential_headers = self._credential_headers(ctx)
        headers = {**credential_headers, **self.config.headers, **(inputs.get("headers") or {})}
        body = inputs.get("body", self.config.body)
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout_seconds, trust_env=False) as client:
                response = await client.request(
                    self.config.method,
                    self.config.url,
                    headers=headers,
                    json=body if body is not None else None,
                )
        except (httpx.RequestError, httpx.TimeoutException) as exc:
            return {
                "error": {
                    "message": str(exc),
                    "type": exc.__class__.__name__,
                }
            }
        if response.is_error:
            return {
                "error": {
                    "status_code": response.status_code,
                    "body": response.text,
                }
            }
        try:
            response_body = response.json()
        except ValueError:
            response_body = response.text
        return {
            "success": {
                "status_code": response.status_code,
                "headers": dict(response.headers),
                "body": response_body,
            }
        }

    def _credential_headers(self, ctx: NodeContext) -> dict[str, str]:
        if self.config.credential_id is None:
            return {}
        credential = ctx.get_credential(self.config.credential_id)
        if credential is None:
            raise ValueError("未能读取此节点引用的凭据。")
        if credential.type_id == "http.bearer":
            value = f"Bearer {credential.data['token']}"
            ctx.register_secret(value)
            return {"Authorization": value}
        if credential.type_id == "http.basic":
            encoded = base64.b64encode(
                f"{credential.data['username']}:{credential.data['password']}".encode("utf-8")
            ).decode("ascii")
            value = f"Basic {encoded}"
            ctx.register_secret(value)
            return {"Authorization": value}
        if credential.type_id == "http.header":
            return {credential.data["name"]: credential.data["value"]}
        raise ValueError("此节点不支持所选凭据类型。")
