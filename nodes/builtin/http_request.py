import base64
import asyncio
import hashlib
import json
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
from nodeflow_sdk.expressions import resolve_expression


class HttpRequestConfig(NodeConfig):
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "GET"
    http_profile_id: str | None = Field(default=None, title="HTTP Profile")
    url: str = Field(..., title="URL")
    headers: dict[str, str] = Field(default_factory=dict, title="Headers")
    credential_id: str | None = Field(default=None, title="Credential")
    body: Any = Field(default=None, title="Body")
    timeout_seconds: int = Field(default=30, ge=1, le=300)
    authentication: dict[str, Any] = Field(default_factory=dict, title="Authentication")
    operation: Literal["unknown", "read", "write"] = "unknown"
    response_checks: list[dict[str, Any]] = Field(default_factory=list)


HTTP_METHOD_OPTIONS = (
    SelectOption("GET", "GET"),
    SelectOption("POST", "POST"),
    SelectOption("PUT", "PUT"),
    SelectOption("PATCH", "PATCH"),
    SelectOption("DELETE", "DELETE"),
)
HTTP_METHODS_WITH_BODY = FormCondition("method", one_of=("POST", "PUT", "PATCH"))


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
                "profile",
                "请求配置档",
                fields=(
                    FormField(
                        "http_profile_id",
                        control="http_profile",
                        label="HTTP 配置档",
                        description="继承 Base URL、公共请求头、凭据和超时；节点内配置可覆盖。",
                    ),
                ),
            ),
            FormGroup(
                "request",
                "请求",
                fields=(
                    FormField("method", control="select", label="请求方法", options=HTTP_METHOD_OPTIONS),
                    FormField("url", control="url", label="URL", placeholder="https://api.example.com/users"),
                    FormField("timeout_seconds", control="number", label="超时（秒）"),
                    FormField("operation", control="select", label="操作语义", expression="disabled",
                              options=(("unknown", "未声明（预演只生成计划）"), ("read", "只读查询（预演会访问远端）"), ("write", "写入操作（预演只生成计划）"))),
                ),
            ),
            FormGroup(
                "content",
                "内容",
                fields=(
                    FormField("body", control="json", label="请求体", visible_when=HTTP_METHODS_WITH_BODY),
                    FormField("headers", control="json", label="请求头"),
                    FormField("response_checks", control="json", label="响应失败条件", expression="disabled",
                              description="条件包含 path、in 数组和 message；命中时输出错误。"),
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
                        credential_type_ids=(),
                    ),
                ),
            ),
        )
    ),
)
class HttpRequestNode(BaseNode[HttpRequestConfig]):
    effect = "unknown"
    preview_support = "plan"

    @classmethod
    def can_retry(cls, config: dict[str, Any]) -> bool:
        return config.get("operation") == "read"

    async def preview(self, ctx: NodeContext, inputs: dict):
        from nodeflow_sdk import PlannedEffect, PreviewResult
        if self.config.operation == "read":
            return PreviewResult(outputs=await self.execute(ctx, inputs), complete=True)
        # Do not authenticate or issue any request for an undeclared/write action.
        return PreviewResult(effects=(PlannedEffect(
            operation=f"HTTP {self.config.method}", target=self.config.url,
            details={"body": inputs.get("body", self.config.body), "credential_id": self.config.credential_id},
            description="仅计划请求；未声明只读语义时不访问远端，也不生成响应或资源 ID",
        ),))
    inputs = {
        "body": Input(display_name="请求体", required=False, description="Request body", schema=ANY_JSON_SCHEMA),
        "headers": Input(display_name="请求头", required=False, description="Request headers", schema=STRING_MAP_SCHEMA),
    }
    outputs = {
        "success": Output(display_name="响应", description="Response data", schema=HTTP_RESPONSE_SCHEMA),
        "error": Output(display_name="错误", category="error", description="Request error", schema=ERROR_SCHEMA),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        session = self._session(ctx)
        credential_headers = self._credential_headers(ctx)
        try:
            async with session["lock"]:
                await self._ensure_authenticated(ctx, session)
        except (httpx.RequestError, httpx.TimeoutException, ValueError) as exc:
            return {"error": {"message": str(exc), "type": exc.__class__.__name__}}
        headers = {**credential_headers, **session["headers"], **self.config.headers, **(inputs.get("headers") or {})}
        body = inputs.get("body", self.config.body)
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout_seconds, trust_env=False, cookies=session["cookies"]) as client:
                response = await client.request(self.config.method, self.config.url, headers=headers, json=body if body is not None else None)
                session["cookies"].update(client.cookies)
                refresh = self.config.authentication.get("refresh_on")
                if isinstance(refresh, dict) and self._check_matches(response, refresh):
                    async with session["lock"]:
                        if all(headers.get(name) == value for name, value in session["headers"].items()):
                            session["authenticated"] = False
                            session["headers"].clear()
                        await self._ensure_authenticated(ctx, session)
                    headers = {**credential_headers, **session["headers"], **self.config.headers, **(inputs.get("headers") or {})}
                    response = await client.request(self.config.method, self.config.url, headers=headers, json=body if body is not None else None)
                    session["cookies"].update(client.cookies)
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
        for check in self.config.response_checks:
            if self._check_matches(response, check):
                return {"error": {"message": check.get("message", "响应未通过业务校验"), "type": "ResponseValidationError"}}
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
        if self.config.authentication.get("mode") == "login":
            return {}
        raise ValueError("此节点不支持所选凭据类型。")

    def _session(self, ctx: NodeContext) -> dict[str, Any]:
        key = json.dumps(
            {"origin": str(httpx.URL(self.config.url).copy_with(path="/", query=None, fragment=None)), "credential": self.config.credential_id, "auth": self.config.authentication},
            sort_keys=True,
            ensure_ascii=False,
        )
        resource_key = f"http.auth.{hashlib.sha256(key.encode()).hexdigest()}"
        return ctx.get_or_create_run_resource(
            resource_key, lambda: {"authenticated": False, "headers": {}, "cookies": httpx.Cookies(), "lock": asyncio.Lock()}
        )

    async def _ensure_authenticated(self, ctx: NodeContext, session: dict[str, Any]) -> None:
        authentication = self.config.authentication
        if authentication.get("mode") != "login" or session["authenticated"]:
            return
        login = authentication.get("login")
        if not isinstance(login, dict):
            raise ValueError("登录认证策略缺少 login 配置。")
        credential = ctx.get_credential(self.config.credential_id or "")
        if credential is None:
            raise ValueError("登录认证策略需要配置凭据。")
        private_context = {**ctx.data, "credential": dict(credential.data)}
        headers = resolve_expression(login.get("headers", {}), private_context)
        body = resolve_expression(login.get("body"), private_context)
        path = str(login.get("path", "")).strip()
        if not path:
            raise ValueError("登录认证策略缺少登录路径。")
        login_url = httpx.URL(self.config.url).join(path) if path.startswith("/") else path
        if path.startswith("/"):
            from urllib.parse import urlsplit
            parsed = urlsplit(self.config.url)
            login_url = f"{parsed.scheme}://{parsed.netloc}{path}"
        async with httpx.AsyncClient(timeout=self.config.timeout_seconds, trust_env=False, cookies=session["cookies"]) as client:
            response = await client.request(str(login.get("method", "POST")).upper(), login_url, headers=headers, json=body)
            response.raise_for_status()
            session["cookies"].update(client.cookies)
        for check in login.get("reject_when", []):
            if self._check_matches(response, check):
                raise ValueError("登录响应未通过认证校验")
        extracts = login.get("extracts")
        if extracts is None:
            legacy_extract = login.get("extract")
            extracts = [legacy_extract] if legacy_extract else []
        if not isinstance(extracts, list) or not all(isinstance(item, dict) for item in extracts):
            raise ValueError("登录认证策略 extracts 必须是对象数组。")
        if not extracts:
            session["authenticated"] = True
            return
        for extract in extracts:
            if extract.get("if_absent") and extract.get("name") in session["headers"]:
                continue
            try:
                token = self._extract_login_value(response, extract)
            except ValueError:
                if extract.get("optional"):
                    continue
                raise
            target = extract.get("target")
            name = extract.get("name")
            if not isinstance(name, str) or not name:
                raise ValueError("登录认证策略缺少认证结果名称。")
            ctx.register_secret(token)
            if target == "header":
                session["headers"][name] = token
            elif target == "cookie":
                session["cookies"].set(name, token)
            else:
                raise ValueError("登录认证策略 target 只能是 header 或 cookie。")
        session["authenticated"] = True

    @staticmethod
    def _check_matches(response: httpx.Response, check: dict[str, Any]) -> bool:
        value: Any = response.status_code if check.get("path") == "$status" else response.json()
        if check.get("path") != "$status":
            for part in str(check.get("path", "")).split("."):
                value = value.get(part) if isinstance(value, dict) else None
        return any(value == expected or (not isinstance(value, bool) and str(value) == str(expected)) for expected in check.get("in", []))

    @staticmethod
    def _extract_login_value(response: httpx.Response, extract: dict[str, Any]) -> str:
        source = extract.get("source", "json")
        path = extract.get("path")
        if not isinstance(path, str) or not path:
            raise ValueError("登录认证策略缺少认证结果路径。")
        if source == "header":
            value = response.headers.get(path)
        elif source == "cookie":
            value = response.cookies.get(path)
        elif source == "json":
            value: Any = response.json()
            for part in path.split("."):
                if not isinstance(value, dict) or part not in value:
                    raise ValueError(f"登录响应中不存在字段：{path}")
                value = value[part]
        else:
            raise ValueError("登录认证策略 source 只能是 json、header 或 cookie。")
        if extract.get("as_text") and isinstance(value, (int, float)) and not isinstance(value, bool):
            value = str(value)
        if not isinstance(value, str) or not value:
            raise ValueError("登录认证策略提取的认证结果必须是非空文本。")
        return value
