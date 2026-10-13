import pytest

from apps.api.nodeflow_api.expressions import ExpressionError, resolve_expression


def test_resolve_expression_reads_nested_path():
    context = {"nodes": {"http_1": {"outputs": {"success": {"body": {"ok": True}}}}}}
    assert resolve_expression("{{ nodes.http_1.outputs.success.body.ok }}", context) is True


def test_resolve_expression_reads_list_index_path():
    context = {"items": [{"name": "Ada"}]}
    assert resolve_expression("{{ items.0.name }}", context) == "Ada"


def test_resolve_expression_reads_bracket_key_path_for_csv_headers():
    context = {"loop": {"item": {"rows": [{"物料编码": "MAT-001"}]}}}
    assert resolve_expression('{{ loop.item.rows.0["物料编码"] }}', context) == "MAT-001"


def test_resolve_expression_returns_literals_without_template():
    assert resolve_expression("hello", {}) == "hello"


def test_resolve_expression_rejects_unknown_path():
    with pytest.raises(ExpressionError):
        resolve_expression("{{ missing.value }}", {})


def test_resolve_expression_rejects_out_of_range_list_index():
    with pytest.raises(ExpressionError):
        resolve_expression("{{ items.3.name }}", {"items": []})
