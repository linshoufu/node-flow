from __future__ import annotations

from typing import Any

from pydantic import Field

from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node

from nodes.builtin._data_utils import resolve_data_path


class StatusCodeAssertConfig(NodeConfig):
    expected: int = Field(default=200, ge=100, le=599)


@node(
    id="assert.status_code",
    name="Assert Status Code",
    category="Assertions",
    description="Assert an HTTP response status code.",
)
class StatusCodeAssertNode(BaseNode[StatusCodeAssertConfig]):
    inputs = {"input": Input(required=True, description="HTTP response")}
    outputs = {
        "passed": Output(description="Assertion passed"),
        "failed": Output(description="Assertion failed"),
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


@node(id="assert.equals", name="Assert Equals", category="Assertions", description="Assert that a value equals expected.")
class EqualsAssertNode(BaseNode[EqualsAssertConfig]):
    inputs = {"input": Input(required=True, description="Source data")}
    outputs = {
        "passed": Output(description="Assertion passed"),
        "failed": Output(description="Assertion failed"),
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


@node(id="assert.contains", name="Assert Contains", category="Assertions", description="Assert that a value contains expected.")
class ContainsAssertNode(BaseNode[ContainsAssertConfig]):
    inputs = {"input": Input(required=True, description="Source data")}
    outputs = {
        "passed": Output(description="Assertion passed"),
        "failed": Output(description="Assertion failed"),
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
