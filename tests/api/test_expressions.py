import pytest

from apps.api.nodeflow_api.expressions import ExpressionError, resolve_expression


def test_resolve_expression_reads_nested_path():
    context = {"nodes": {"http_1": {"outputs": {"success": {"body": {"ok": True}}}}}}
    assert resolve_expression("{{ nodes.http_1.outputs.success.body.ok }}", context) is True


def test_resolve_expression_returns_literals_without_template():
    assert resolve_expression("hello", {}) == "hello"


def test_resolve_expression_rejects_unknown_path():
    with pytest.raises(ExpressionError):
        resolve_expression("{{ missing.value }}", {})
