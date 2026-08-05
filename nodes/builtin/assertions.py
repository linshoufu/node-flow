from __future__ import annotations

from typing import Any

from pydantic import Field

from nodeflow_sdk import BaseNode, FormField, FormGroup, Input, NodeConfig, NodeContext, NodeForm, Output, node

from nodes.builtin._data_utils import resolve_data_path
from nodes.builtin._schemas import ANY_JSON_SCHEMA, ASSERTION_RESULT_SCHEMA, HTTP_RESPONSE_SCHEMA


class StatusCodeAssertConfig(NodeConfig):
    expected: int = Field(default=200, ge=100, le=599)


@node(
    id="assert.status_code",
    name="Assert Status Code",
    category="Assertions",
    description="Assert an HTTP response status code.",
    group="action",
    icon="badge-check",
    tags=["assertion", "http", "testing"],
    keywords=["status", "code", "response", "expect"],
    documentation_url="/docs/nodes/index.html#assert.status_code",
    form=NodeForm(
        groups=(
            FormGroup(
                "assertion",
                "断言",
                fields=(
                    FormField("expected", control="number", label="期望状态码"),
                ),
            ),
        )
    ),
)
class StatusCodeAssertNode(BaseNode[StatusCodeAssertConfig]):
    inputs = {"input": Input(display_name="响应", required=True, description="HTTP response", schema=HTTP_RESPONSE_SCHEMA)}
    outputs = {
        "passed": Output(display_name="通过", description="Assertion passed", schema=ASSERTION_RESULT_SCHEMA),
        "failed": Output(display_name="失败", description="Assertion failed", schema=ASSERTION_RESULT_SCHEMA),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        response = inputs.get("input") or {}
        actual = response.get("status_code") if isinstance(response, dict) else None
        passed = actual == self.config.expected
        result = assertion_result(
            assertion="status_code",
            passed=passed,
            expected=self.config.expected,
            actual=actual,
            message=(
                f"Expected status {self.config.expected}, got {actual}"
                if not passed
                else f"Status code is {actual}"
            ),
        )
        return {"passed" if passed else "failed": result}


class EqualsAssertConfig(NodeConfig):
    actual_path: str = Field(..., title="Actual value path")
    expected: Any = Field(..., title="Expected value")


@node(
    id="assert.equals",
    name="Assert Equals",
    category="Assertions",
    description="Assert that a value equals expected.",
    group="action",
    icon="equal",
    tags=["assertion", "testing"],
    keywords=["equals", "expect", "compare", "actual"],
    documentation_url="/docs/nodes/index.html#assert.equals",
    form=NodeForm(
        groups=(
            FormGroup(
                "comparison",
                "比较",
                fields=(
                    FormField("actual_path", label="数据路径", placeholder="body.user.id", expression="disabled"),
                    FormField("expected", control="textarea", label="期望值"),
                ),
            ),
        )
    ),
)
class EqualsAssertNode(BaseNode[EqualsAssertConfig]):
    inputs = {"input": Input(display_name="数据", required=True, description="Source data", schema=ANY_JSON_SCHEMA)}
    outputs = {
        "passed": Output(display_name="通过", description="Assertion passed", schema=ASSERTION_RESULT_SCHEMA),
        "failed": Output(display_name="失败", description="Assertion failed", schema=ASSERTION_RESULT_SCHEMA),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        try:
            actual = resolve_data_path(inputs.get("input"), self.config.actual_path)
        except Exception as exc:
            actual = None
            passed = False
            message = str(exc)
        else:
            passed = actual == self.config.expected
            message = (
                f"{self.config.actual_path} equals expected value"
                if passed
                else f"Expected {self.config.expected!r}, got {actual!r}"
            )
        result = assertion_result(
            assertion="equals",
            passed=passed,
            expected=self.config.expected,
            actual=actual,
            message=message,
            path=self.config.actual_path,
        )
        return {"passed" if passed else "failed": result}


class ContainsAssertConfig(NodeConfig):
    actual_path: str = Field(..., title="Actual value path")
    expected: Any = Field(..., title="Expected contained value")


@node(
    id="assert.contains",
    name="Assert Contains",
    category="Assertions",
    description="Assert that a value contains expected.",
    group="action",
    icon="search-check",
    tags=["assertion", "testing"],
    keywords=["contains", "include", "expect", "text"],
    documentation_url="/docs/nodes/index.html#assert.contains",
    form=NodeForm(
        groups=(
            FormGroup(
                "comparison",
                "比较",
                fields=(
                    FormField("actual_path", label="数据路径", placeholder="body.message", expression="disabled"),
                    FormField("expected", control="textarea", label="期望包含值"),
                ),
            ),
        )
    ),
)
class ContainsAssertNode(BaseNode[ContainsAssertConfig]):
    inputs = {"input": Input(display_name="数据", required=True, description="Source data", schema=ANY_JSON_SCHEMA)}
    outputs = {
        "passed": Output(display_name="通过", description="Assertion passed", schema=ASSERTION_RESULT_SCHEMA),
        "failed": Output(display_name="失败", description="Assertion failed", schema=ASSERTION_RESULT_SCHEMA),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        try:
            actual = resolve_data_path(inputs.get("input"), self.config.actual_path)
            passed = contains_value(actual, self.config.expected)
            message = (
                f"{self.config.actual_path} contains expected value"
                if passed
                else f"Expected {actual!r} to contain {self.config.expected!r}"
            )
        except Exception as exc:
            actual = None
            passed = False
            message = str(exc)
        result = assertion_result(
            assertion="contains",
            passed=passed,
            expected=self.config.expected,
            actual=actual,
            message=message,
            path=self.config.actual_path,
        )
        return {"passed" if passed else "failed": result}


def assertion_result(
    *,
    assertion: str,
    passed: bool,
    expected: Any,
    actual: Any,
    message: str,
    path: str | None = None,
) -> dict[str, Any]:
    result = {
        "assertion": assertion,
        "status": "passed" if passed else "failed",
        "expected": expected,
        "actual": actual,
        "message": message,
    }
    if path is not None:
        result["path"] = path
    return result


def contains_value(actual: Any, expected: Any) -> bool:
    if isinstance(actual, str):
        return str(expected) in actual
    if isinstance(actual, dict):
        return expected in actual.values() or expected in actual.keys()
    try:
        return expected in actual
    except TypeError:
        return False
