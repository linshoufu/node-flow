from datetime import date
from decimal import Decimal
from typing import Any

from pydantic import Field

from a3_tool.core.config import PurchaseSettings, StockInCategorySettings
from a3_tool.models.purchase.stock_in import PurchaseStockInItem, PurchaseStockInRequest, WarehouseRef
from a3_tool.payloads.purchase.stock_in import build_purchase_stock_in_payload
from nodeflow_sdk import BaseNode, FormField, FormGroup, Input, NodeConfig, NodeContext, NodeForm, Output, node
from nodes.builtin._schemas import ANY_JSON_SCHEMA, ERROR_SCHEMA, HTTP_RESPONSE_SCHEMA


class PurchaseStockInPayloadConfig(NodeConfig):
    category_id: str = Field(...)
    category_code: str = Field(default="BZRK")
    category_name: str = Field(default="标准采购入库单")
    business_name: str = Field(default="标准采购")
    menu_code: str = Field(...)
    purchase_order_menu_code: str = Field(...)


@node(tags=["legacy"], id="a3.purchase_stock_in_payload", documentation_url="/docs/nodes/index.html#a3.purchase_stock_in_payload", name="采购入库 Payload 组装", category="A3 采购", description="按采购订单和已分组 CSV 校验并组装采购入库单。", group="action", icon="package", form=NodeForm(groups=(FormGroup("category", "单据类别", fields=(FormField("category_id", label="类别 ID"), FormField("category_code", label="类别编码"), FormField("category_name", label="类别名称"), FormField("business_name", label="业务名称"), FormField("menu_code", label="入库菜单编码"), FormField("purchase_order_menu_code", label="采购订单菜单编码"))),)))
class PurchaseStockInPayloadNode(BaseNode[PurchaseStockInPayloadConfig]):
    effect = "pure"
    preview_support = "execute"
    inputs = {"group": Input(display_name="CSV 分组", required=False, schema=ANY_JSON_SCHEMA), "order": Input(display_name="采购订单响应", required=True, schema=HTTP_RESPONSE_SCHEMA)}
    outputs = {"success": Output(display_name="入库 Payload", schema=ANY_JSON_SCHEMA), "error": Output(display_name="校验错误", category="error", schema=ERROR_SCHEMA)}

    async def execute(self, ctx: NodeContext, inputs: dict[str, Any]) -> dict[str, Any]:
        try:
            group = inputs.get("group") or (ctx.data.get("loop") or {}).get("item")
            if not isinstance(group, dict):
                raise ValueError("采购入库计算需要 CSV 分组输入，或在循环体内运行。")
            rows = group["rows"]
            first = rows[0]
            category = StockInCategorySettings(self.config.category_code, self.config.category_id, self.config.category_name, self.config.category_code, self.config.business_name, self.config.menu_code)
            warehouse = WarehouseRef(str(first.get("仓库", "")), str(first.get("仓库ID", "")))
            request = PurchaseStockInRequest(str(first["源单单号"]), warehouse, date.fromisoformat(str(first["过账日期"])), tuple(PurchaseStockInItem(str(row["物料编码"]), Decimal(str(row["数量"])), Decimal(str(row["含税单价"])) if row.get("含税单价") else None) for row in rows), category)
            records = inputs["order"].get("body", {}).get("data", {}).get("records", [])
            settings = PurchaseSettings(self.config.purchase_order_menu_code, self.config.category_code, {self.config.category_code: category})
            return {"success": build_purchase_stock_in_payload(records, request, settings)}
        except Exception as exc:
            return {"error": {"message": str(exc), "type": exc.__class__.__name__}}
