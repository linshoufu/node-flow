import asyncio
import json
from pathlib import Path

import pytest

from nodeflow_sdk.data_recipes import DataExpression
from nodes.builtin.records import ComposeNode, RecordsPrepareNode, RecordsGroupNode


def execute(cls, config, inputs):
    return asyncio.run(cls(config=config).execute(None, inputs))


def test_generic_mapping_and_group_rejects_whole_invalid_group():
    dataset = {"headers": ["单号", "金额"], "rows": [{"单号": "A", "金额": "2.30"}, {"单号": "A", "金额": "bad"}, {"单号": "B", "金额": "4.50"}], "line_numbers": [4, 7, 8]}
    records = execute(RecordsPrepareNode, {"columns": [{"name": "key", "expression": "row['单号']", "required": True}, {"name": "amount", "expression": "row['金额']", "type": "decimal"}]}, {"dataset": dataset})["success"]
    result = execute(RecordsGroupNode, {"by": ["key"], "header_fields": ["key"]}, {"records": records})
    assert len(result["success"]) == 1
    assert result["success"][0]["header"] == {"key": "B"}
    assert result["failures"][0]["line_numbers"] == [4, 7]
    assert result["failures"][0]["errors"][0]["line_number"] == 7


@pytest.mark.parametrize("expression", ["__import__('os')", "inputs.__class__", "inputs.clear()", "(lambda: 1)()", "[0] * 100000000", "2 ** 99999"])
def test_data_expressions_reject_python_execution(expression):
    with pytest.raises((ValueError, KeyError)):
        DataExpression().evaluate(expression, {"inputs": {}})


def test_non_a3_recipe_maps_items_and_calculates_decimal_totals():
    result = execute(ComposeNode, {"rules": [{"name": "lines", "each": "inputs.input", "expression": "{'sku': item.sku, 'total': text(decimal(item.price) * decimal(item.count), 2)}"}], "output": "{'lines':lines, 'total':text(sum(decimal(line.total) for line in lines), 2)}"}, {"input": [{"sku": "book", "price": "0.10", "count": "3"}]})
    assert result["success"] == {"lines": [{"sku": "book", "total": "0.30"}], "total": "0.30"}


@pytest.mark.parametrize("custom_price", [None, "125.6789"])
def test_a3_preset_payload_matches_baogong_offline(custom_price):
    pytest.importorskip("a3_tool")
    from a3_tool.core.config import PurchaseSettings, StockInCategorySettings
    from a3_tool.models.purchase.stock_in import PurchaseStockInRequest, WarehouseRef, PurchaseStockInItem
    from a3_tool.payloads.purchase.stock_in import build_purchase_stock_in_payload
    from datetime import date
    from decimal import Decimal

    workflow = json.loads(Path("examples/a3_purchase/workflow.json").read_text(encoding="utf-8"))
    nodes = {node["id"]: node for node in workflow["nodes"]}
    options = {field["name"]: field["default"] for field in workflow["settings"]["configuration"]}
    row = {"源单单号": "CGDD1", "仓库": "测试仓库", "仓库ID": "warehouse-test", "过账日期": "2026-10-15", "物料编码": "212", "数量": "2", "含税单价": custom_price or ""}
    prepared = execute(RecordsPrepareNode, {**nodes["prepare"]["config"], "options": options}, {"dataset": {"headers": list(row), "rows": [row]}, "options": options})["success"]
    assert prepared["records"][0]["errors"] == []
    groups = execute(RecordsGroupNode, nodes["tasks"]["config"], {"records": prepared})["success"]
    record = json.loads(Path("tests/fixtures/a3_purchase/purchase_order_line.json").read_text(encoding="utf-8"))
    build = next(node for node in nodes["each"]["subflows"]["body"]["nodes"] if node["id"] == "build")
    actual = execute(ComposeNode, build["config"], {"context": groups[0], "input": {"body": {"data": {"records": [record]}}}})["success"]
    category = StockInCategorySettings(**options["categories"][0])
    settings = PurchaseSettings(options["purchase_order_menu_code"], options["default_stock_in_category"], {category.code: category})
    request = PurchaseStockInRequest("CGDD1", WarehouseRef("测试仓库", "warehouse-test"), date(2026, 10, 15), (PurchaseStockInItem("212", Decimal("2"), Decimal(custom_price) if custom_price else None),), category)
    assert actual == build_purchase_stock_in_payload([record], request, settings)


def test_new_template_uses_only_platform_nodes_and_preview():
    workflow = json.loads(Path("examples/a3_purchase/workflow.json").read_text(encoding="utf-8"))
    def walk(nodes):
        for node in nodes:
            yield node
            for body in node.get("subflows", {}).values():
                yield from walk(body["nodes"])
    assert workflow["settings"]["run_mode"] == "preview"
    assert workflow["active"] is False
    assert all(not node["type"].startswith("a3.") for node in walk(workflow["nodes"]))
