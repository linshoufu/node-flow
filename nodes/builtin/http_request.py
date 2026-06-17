from typing import Literal

import httpx
from pydantic import Field

from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node


class HttpRequestConfig(NodeConfig):
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "GET"
    url: str = Field(..., title="URL")
    timeout_seconds: int = Field(default=30, ge=1, le=300)


@node(id="http.request", name="HTTP Request", category="Network", description="Send an HTTP request.")
class HttpRequestNode(BaseNode[HttpRequestConfig]):
    inputs = {
        "body": Input(required=False, description="Request body"),
        "headers": Input(required=False, description="Request headers"),
    }
    outputs = {
        "success": Output(description="Response data"),
        "error": Output(description="Request error"),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        headers = inputs.get("headers") or {}
        body = inputs.get("body")
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout_seconds) as client:
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
