import asyncio
from pathlib import Path

import pytest
from pydantic import ValidationError

from nodes.builtin.records import GroupConfig, RecordsGroupNode, merge_group_fields


def group(config, rows):
    records = [{"values": row, "line_number": index + 2, "errors": []} for index, row in enumerate(rows)]
    return asyncio.run(RecordsGroupNode(config=config).execute(None, {"records": {"records": records}}))


def test_common_fields_split_and_error_have_distinct_behavior():
    rows = [{"account": "A", "currency": "CNY"}, {"account": "A", "currency": "USD"}, {"account": "B", "currency": "CNY"}]
    config = {"common_fields": [{"name": "account", "on_difference": "split"}, {"name": "currency", "on_difference": "error"}]}
    result = group(config, rows)
    assert [item["header"] for item in result["success"]] == [{"account": "B", "currency": "CNY"}]
    assert result["failures"][0]["line_numbers"] == [2, 3]
    config["common_fields"][1]["on_difference"] = "split"
    assert len(group(config, rows)["success"]) == 3


def test_legacy_conversion_preserves_partition_empty_values_and_header_projection():
    old = {"by": ["account", "optional"], "header_fields": ["currency", "account"], "optional_keys": ["optional"], "unique_items": ["sku"]}
    new = {"common_fields": merge_group_fields(old), "unique_items": old["unique_items"]}
    rows = [{"account": "A", "optional": "", "sku": "one"}, {"account": "A", "optional": "", "sku": "two"}, {"account": "B", "optional": None, "sku": "one"}]
    assert group(old, rows) == group(new, rows)
    assert group(new, rows)["success"][0]["header"] == {"currency": None, "account": "A"}
    rows.append({"account": "A", "sku": "three"})
    assert group(old, rows) == group(new, rows)
    assert group(new, rows)["failures"][0]["line_numbers"] == [5]


def test_error_only_rules_group_all_rows_and_reject_required_empty_values():
    config = {"common_fields": [{"name": "currency", "on_difference": "error"}]}
    assert len(group(config, [{"currency": "CNY"}, {"currency": "CNY"}])["success"]) == 1
    result = group(config, [{}, {"currency": "CNY"}])
    assert result["success"] == []
    assert result["failures"][0]["line_numbers"] == [2, 3]


def test_unique_items_and_upstream_errors_still_reject_the_entire_group():
    config = {"common_fields": [{"name": "account"}], "unique_items": ["sku"]}
    result = group(config, [{"account": "A", "sku": "same"}] * 2)
    assert result["success"] == []
    assert result["failures"][0]["line_numbers"] == [2, 3]


@pytest.mark.parametrize("fields", [[{"name": " "}], [{"name": "x", "on_difference": "unknown"}], [{"name": "x"}, {"name": "x"}]])
def test_invalid_rules_are_rejected(fields):
    with pytest.raises(ValidationError):
        GroupConfig(common_fields=fields)


def test_explicit_rules_override_legacy_aliases_without_mutating_the_input():
    config = {"common_fields": [{"name": "key"}], "by": ["obsolete"]}
    assert group(config, [{"key": "A"}])["success"][0]["header"] == {"key": "A"}
    assert config["by"] == ["obsolete"]


def test_legacy_group_field_bindings_keep_resolving():
    from apps.api.nodeflow_api.config_bindings import resolve_workflow_bindings
    from apps.api.nodeflow_api.node_registry import NodeRegistry
    from apps.api.nodeflow_api.schemas import WorkflowDocument

    registry = NodeRegistry(nodes_dir=Path("nodes"))
    registry.scan()
    document = WorkflowDocument.model_validate({"id": "legacy-group", "name": "Legacy", "settings": {
        "configuration": [{"name": "keys", "type": "json", "default": ["account"]}]},
        "nodes": [{"id": "group", "type": "data.records_group", "position": {"x": 0, "y": 0},
                   "config": {"header_fields": ["account", "currency"]},
                   "configBindings": {"by": {"source": "workflow", "key": "keys"}}}], "edges": []})
    resolved = resolve_workflow_bindings(document, registry, runtime=True)
    assert group(resolved.nodes[0].config, [{"account": "A", "currency": "CNY"}])["success"][0]["header"] == {"account": "A", "currency": "CNY"}
    assert document.nodes[0].config == {"header_fields": ["account", "currency"]}
