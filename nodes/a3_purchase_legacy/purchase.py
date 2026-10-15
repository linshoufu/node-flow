"""A3 purchase adapters. Business rules remain in the a3-tool distribution."""
import asyncio
from dataclasses import asdict
from datetime import date
from decimal import Decimal
import threading
from typing import Literal

import httpx
from pydantic import Field, field_validator, model_validator

from a3_tool.capabilities.purchase.orders import PurchaseOrderCapabilities
from a3_tool.capabilities.purchase.stock_in import PurchaseStockInCapabilities
from a3_tool.core.client import A3Client
from a3_tool.core.config import A3Settings, ConnectionSettings, Credentials, PurchaseSettings, StockInCategorySettings, WarehouseRef as DefaultWarehouse
from a3_tool.core.transport import RawResponse
from a3_tool.inputs.csv_tasks import CsvRowError, CsvSourceRow, TaskBuildError
from a3_tool.inputs.purchase.stock_in_csv import PurchaseStockInCsvAdapter
from a3_tool.models.purchase.stock_in import PurchaseStockInItem, PurchaseStockInRequest, WarehouseRef
from a3_tool.payloads.purchase.stock_in import build_purchase_stock_in_payload
from nodeflow_sdk import BaseNode, ConfigExpression, FormField, FormGroup, Input, NodeConfig, NodeContext, NodeForm, Output, ProfileType, node
from nodeflow_sdk.datasets import RECORD_DATASET_SCHEMA, RecordDataset
from nodeflow_sdk.loops import LOOP_RESULTS_SCHEMA


def plan_records(dataset: RecordDataset, adapter, *, group_by=None):
    """Bridge records to the upstream adapter without reading a file.

    CsvTaskPlanner currently only accepts paths. Keep orchestration here while
    delegating parsing, grouping keys and document validation to its public adapter.
    """
    missing = sorted(adapter.required_columns - set(dataset.headers))
    if missing:
        raise ValueError(f"CSV 缺少列: {missing}")
    if not dataset.rows:
        raise ValueError("CSV 没有数据行")
    fields = adapter.default_group_by
    identity = adapter.required_group_by
    if group_by is not None:
        fields = tuple(str(value).strip() for value in group_by)
        if not fields or any(not field for field in fields) or len(set(fields)) != len(fields):
            raise ValueError("分组字段必须非空且不重复")
        if set(fields) - set(dataset.headers):
            raise ValueError("分组字段引用了数据中不存在的列")
        if set(adapter.required_group_by) - set(fields):
            raise ValueError(f"分组字段必须包含: {adapter.required_group_by}")
        identity = fields

    def row_error(row, exc):
        message = str(exc)
        if not message.startswith("CSV 第"):
            message = f"CSV 第 {row.line_number} 行数据无效: {message}"
        return CsvRowError(row.line_number, type(exc).__name__, message)

    def failure(ordinal, rows, errors):
        by_line = {}
        for error in sorted(errors, key=lambda value: value.line_number):
            by_line.setdefault(error.line_number, []).append(error)
        return {"ordinal": ordinal, "line_numbers": [row.line_number for row in rows], "errors": [
            {"line_number": line, "error_type": "+".join(dict.fromkeys(e.error_type for e in values)),
             "message": "; ".join(dict.fromkeys(e.message for e in values))}
            for line, values in by_line.items()
        ]}

    slots = {}
    failures = []
    for line, values in zip(dataset.line_numbers, dataset.rows, strict=True):
        row = CsvSourceRow(line, {key: str(value) if value is not None else "" for key, value in values.items()})
        empty = [field for field in identity if not row.values.get(field, "").strip()]
        if empty:
            errors = [CsvRowError(line, "ValueError", f"CSV 第 {line} 行无法确定单据任务归属，字段为空: {empty}")]
            try:
                adapter.parse(row)
            except (ValueError, KeyError, TypeError) as exc:
                errors.append(row_error(row, exc))
            failures.append(failure(None, [row], errors))
            continue
        try:
            location = adapter.locate(row, fields)
        except (ValueError, KeyError) as exc:
            failures.append(failure(None, [row], [row_error(row, exc)]))
            continue
        if location.key not in slots:
            slots[location.key] = {"ordinal": len(slots) + 1, "rows": [], "parsed": [], "errors": []}
        slot = slots[location.key]
        slot["rows"].append(row)
        try:
            slot["parsed"].append((row, adapter.parse(row)))
        except (ValueError, KeyError, TypeError) as exc:
            slot["errors"].append(row_error(row, exc))

    tasks = []
    for slot in slots.values():
        value = None
        if not slot["errors"]:
            try:
                value = adapter.build(slot["parsed"], fields)
            except TaskBuildError as exc:
                slot["errors"].extend(exc.errors)
            except (ValueError, KeyError, TypeError) as exc:
                slot["errors"].append(row_error(slot["rows"][0], exc))
        if slot["errors"]:
            failures.append(failure(slot["ordinal"], slot["rows"], slot["errors"]))
        else:
            tasks.append({"ordinal": slot["ordinal"], "request": asdict(value),
                          "line_numbers": [row.line_number for row in slot["rows"]]})
    return tasks, sorted(failures, key=lambda value: value["line_numbers"][0])


class CategoryConfig(NodeConfig):
    code: str = "BZRK"
    id: str = Field(min_length=1)
    name: str = "标准采购入库单"
    business_id: str = "BZRK"
    business_name: str = "标准采购"
    menu_code: str = Field(min_length=1)


class WarehouseConfig(NodeConfig):
    name: str
    id: str


class PurchaseProfile(NodeConfig):
    base_url: str = Field(pattern=r"^https?://[^/]+", title="系统地址")
    client_type: str = Field(default="mom_web", title="客户端类型")
    timeout_seconds: float = Field(default=30, gt=0, le=300, title="请求超时（秒）")
    purchase_order_menu_code: str = Field(min_length=1, title="采购订单菜单编码")
    default_stock_in_category: str = Field(default="BZRK", title="默认入库类别")
    stock_in_categories: dict[str, CategoryConfig] = Field(title="入库类别映射")
    default_warehouse: WarehouseConfig | None = Field(default=None, title="默认仓库")

    @model_validator(mode="after")
    def valid_categories(self):
        if self.default_stock_in_category not in self.stock_in_categories:
            raise ValueError("默认类别不存在")
        if any(key != value.code for key, value in self.stock_in_categories.items()):
            raise ValueError("类别键和类别编码必须一致")
        return self


PROFILE = ProfileType("a3.purchase", "A3 采购配置", PurchaseProfile, ("a3.account",))


class ProfileNodeConfig(NodeConfig):
    profile_id: str = Field(min_length=1)


def settings(ctx):
    profile = PurchaseProfile.model_validate(ctx.profile["data"])
    categories = {key: StockInCategorySettings(**value.model_dump()) for key, value in profile.stock_in_categories.items()}
    return profile, PurchaseSettings(profile.purchase_order_menu_code, profile.default_stock_in_category, categories)


class HttpxTransport:
    def send(self, method, url, *, headers, json_body=None, timeout_seconds=30):
        response = httpx.request(method, url, headers=headers, json=json_body, timeout=timeout_seconds)
        return RawResponse(response.status_code, response.reason_phrase, response.text)


class PurchaseSession:
    def __init__(self, client):
        self.client = client
        self.lock = threading.Lock()


async def call_a3(ctx, operation):
    profile, purchase = settings(ctx)
    credential = ctx.get_credential(ctx.profile.get("credential_id", ""))
    if credential is None:
        raise ValueError("A3 配置档缺少账号凭据")

    def create():
        client_settings = A3Settings(
            ConnectionSettings(profile.base_url.rstrip("/"), profile.client_type, profile.timeout_seconds),
            Credentials(credential.data["tenancy_code"], credential.data["username"], credential.data["password"]),
            purchase,
        )
        return PurchaseSession(A3Client(client_settings, transport=HttpxTransport()))

    session = ctx.get_or_create_run_resource(f"a3.purchase:{ctx.profile['id']}:{credential.id}", create)

    def invoke():
        with session.lock:
            try:
                return operation(session.client, purchase)
            except Exception as exc:
                # A3 HTTP exceptions may contain raw response bodies. Never log those.
                raise ValueError(f"A3 操作失败（{type(exc).__name__}），请核对配置、源单和服务状态") from None
            finally:
                for value in (session.client._access_token, session.client._token_uuid, session.client._tenancy_id):
                    if value:
                        ctx.register_secret(value)

    return await asyncio.to_thread(invoke)


def request_from_json(value):
    return PurchaseStockInRequest(
        value["order_code"], WarehouseRef(**value["warehouse"]), date.fromisoformat(value["posting_date"]),
        tuple(PurchaseStockInItem(item["material_code"], Decimal(item["quantity"]),
              Decimal(item["including_tax_price"]) if item["including_tax_price"] is not None else None) for item in value["items"]),
        StockInCategorySettings(**value["category"]),
        date.fromisoformat(value["order_date"]) if value.get("order_date") else None,
        value.get("document_code"),
    )


def task_request(ctx, task):
    if task.get("profile_id") != ctx.profile["id"]:
        raise ValueError("单据任务与当前节点的业务配置档不一致")
    return request_from_json(task["request"])


def json_value(value):
    if isinstance(value, dict):
        return {key: json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    if isinstance(value, (date, Decimal)):
        return str(value)
    return value


def form(*fields):
    return NodeForm(groups=(FormGroup("purchase", "采购入库", fields=(
        FormField("profile_id", label="业务配置档"), *fields,
    )),))


class TaskConfig(ProfileNodeConfig):
    group_by: list[str] | None = None

    @field_validator("group_by")
    @classmethod
    def valid_group_fields(cls, value):
        if value is None:
            return None
        fields = [field.strip() for field in value]
        if not fields or any(not field for field in fields) or len(set(fields)) != len(fields):
            raise ValueError("分组字段必须非空且不重复；删除全部字段可恢复默认分组")
        return fields


@node(tags=["legacy"], id="a3.purchase_tasks", version=2, documentation_url="/docs/nodes/index.html#a3.purchase_tasks", name="生成采购入库任务", category="A3 采购", icon="table",
      description="接收表格数据，按采购业务规则分组、校验并生成单据任务。", form=form(FormField("group_by", control="string_list", label="分组字段（留空使用业务默认）", expression="disabled")))
class PurchaseTasksNode(BaseNode[TaskConfig]):
    effect = "pure"
    preview_support = "execute"
    profile_type = PROFILE
    inputs = {"dataset": Input(display_name="表格数据", schema=RECORD_DATASET_SCHEMA)}
    outputs = {
        "tasks": Output(display_name="单据任务", schema={"type": "array", "items": {"type": "object"}}),
        "input_failures": Output(display_name="输入校验失败", schema={"type": "array", "items": {"type": "object"}}),
    }

    @classmethod
    def migrate_config(cls, from_version, config):
        return {key: value for key, value in config.items() if key != "path"}

    async def execute(self, ctx: NodeContext, inputs: dict):
        profile, purchase = settings(ctx)
        warehouse = DefaultWarehouse(**profile.default_warehouse.model_dump()) if profile.default_warehouse else None
        tasks, failures = plan_records(RecordDataset.model_validate(inputs["dataset"]),
                                      PurchaseStockInCsvAdapter(purchase, warehouse), group_by=self.config.group_by)
        return {"tasks": [json_value({**task, "profile_id": ctx.profile["id"]}) for task in tasks],
                "input_failures": failures}


@node(tags=["legacy"], id="a3.purchase_order_query", version=2, documentation_url="/docs/nodes/index.html#a3.purchase_order_query", name="查询可入库采购订单", category="A3 采购", icon="search",
      description="按单据任务查询可入库订单，共享运行内登录会话。", form=form())
class PurchaseOrderQueryNode(BaseNode[ProfileNodeConfig]):
    effect = "read"
    preview_support = "execute"
    profile_type = PROFILE
    inputs = {"task": Input(display_name="单据任务", schema={"type": "object"})}
    outputs = {"success": Output(display_name="订单与任务", schema={"type": "object"})}

    async def execute(self, ctx: NodeContext, inputs: dict):
        task = inputs.get("task")
        if not isinstance(task, dict):
            raise ValueError("请通过输入端口传入单据任务")
        request = task_request(ctx, task)
        records = await call_a3(ctx, lambda client, purchase: PurchaseOrderCapabilities(client, purchase).find_stockable_order_lines(request.order_code, request.category))
        return {"success": {"task": task, "records": records}}

    @classmethod
    def migrate_config(cls, from_version, config):
        return dict(config)


@node(tags=["legacy"], id="a3.purchase_build_payload", documentation_url="/docs/nodes/index.html#a3.purchase_build_payload", name="组装采购入库单", category="A3 采购", icon="package",
      description="复用 A3 来源匹配、数量和金额计算规则。", form=form())
class PurchaseBuildPayloadNode(BaseNode[ProfileNodeConfig]):
    effect = "pure"
    preview_support = "execute"
    profile_type = PROFILE
    inputs = {"order": Input(display_name="订单与任务", schema={"type": "object"})}
    outputs = {"success": Output(display_name="待保存单据", schema={"type": "object"})}

    async def execute(self, ctx: NodeContext, inputs: dict):
        value = inputs["order"]
        _, purchase = settings(ctx)
        request = task_request(ctx, value["task"])
        payload = build_purchase_stock_in_payload(value["records"], request, purchase)
        return {"success": {"task": value["task"], "payload": payload}}


class SaveConfig(ProfileNodeConfig):
    mode: Literal["preview", "save"] | ConfigExpression = "preview"


@node(tags=["legacy"], id="a3.purchase_save", documentation_url="/docs/nodes/index.html#a3.purchase_save", name="预览或保存采购入库单", category="A3 采购", icon="save",
      description="兼容旧版节点级模式；平台预演始终禁止保存。新流程推荐使用保存采购入库单节点。",
      form=form(FormField("mode", control="select", label="执行模式", options=(("preview", "预览"), ("save", "正式保存")))))
class PurchaseSaveNode(BaseNode[SaveConfig]):
    effect = "write"
    preview_support = "plan"

    async def preview(self, ctx: NodeContext, inputs: dict):
        from nodeflow_sdk import PlannedEffect, PreviewResult
        value = inputs["document"]
        task_request(ctx, value["task"])
        result = {**value, "mode": "preview", "document_id": None, "status": "previewed"}
        return PreviewResult(
            effects=(PlannedEffect("create_document", ctx.profile["data"]["base_url"], value["payload"], "计划保存采购入库单，未提交"),),
            outputs={"success": result}, complete=True,
        )
    retry_safe = False
    profile_type = PROFILE
    inputs = {"document": Input(display_name="待保存单据", schema={"type": "object"})}
    outputs = {"success": Output(display_name="处理结果", schema={"type": "object"})}

    async def execute(self, ctx: NodeContext, inputs: dict):
        value = inputs["document"]
        request = task_request(ctx, value["task"])
        document_id = None
        if self.config.mode == "save":
            document_id = await call_a3(ctx, lambda client, purchase: PurchaseStockInCapabilities(client).save_stock_in(value["payload"], request.category))
            if not document_id:
                raise ValueError("A3 保存响应缺少单据 ID，请核实源系统结果后再决定是否重跑")
        result = {**value, "mode": self.config.mode, "document_id": document_id,
                  "status": "previewed" if self.config.mode == "preview" else "saved"}
        return {"success": result}


@node(tags=["legacy"], id="a3.purchase_summary", version=2, documentation_url="/docs/nodes/index.html#a3.purchase_summary", name="采购入库结果汇总", category="A3 采购", icon="list",
      description="汇总预览、已保存单据、输入失败和执行失败；有失败时标记失败分支。")
class PurchaseSummaryNode(BaseNode[NodeConfig]):
    effect = "pure"
    preview_support = "execute"
    inputs = {
        "input_failures": Input(display_name="输入校验失败", schema={"type": "array", "items": {"type": "object"}}),
        "results": Input(display_name="逐项结果", schema=LOOP_RESULTS_SCHEMA),
    }
    outputs = {
        "success": Output(display_name="全部成功", schema={"type": "object"}),
        "failed": Output(display_name="包含失败", category="error", schema={"type": "object"}),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        outcomes = inputs["results"]
        results = [item["output"] for item in outcomes if item["status"] == "succeeded"]
        failures = inputs["input_failures"]
        errors = [{"index": item["index"], "task": item["item"], "message": item["error"]}
                  for item in outcomes if item["status"] == "failed"]
        unverified = [item for item in outcomes if item["status"] == "unverified"]
        if len(results) + len(errors) + len(unverified) != len(outcomes):
            raise ValueError("逐项结果包含未知状态")
        report = {"total": len(outcomes) + len(failures),
                  "succeeded": len(results), "failed": len(failures) + len(errors),
                  "results": results, "input_failures": failures, "execution_failures": errors}
        if unverified:
            report["unverified"] = unverified
        return {"failed" if report["failed"] else "success": report}

    @classmethod
    def migrate_config(cls, from_version, config):
        return dict(config)


@node(tags=["legacy"], id="a3.purchase_submit", documentation_url="/docs/nodes/index.html#a3.purchase_submit", name="保存采购入库单", category="A3 采购", icon="save",
      description="遵循平台运行策略：预演输出待提交单据，正式执行保存并返回单据 ID。", form=form())
class PurchaseSubmitNode(BaseNode[ProfileNodeConfig]):
    effect = "write"
    preview_support = "plan"
    retry_safe = False
    profile_type = PROFILE
    inputs = PurchaseSaveNode.inputs
    outputs = PurchaseSaveNode.outputs
    preview = PurchaseSaveNode.preview

    async def execute(self, ctx: NodeContext, inputs: dict):
        value = inputs["document"]
        request = task_request(ctx, value["task"])
        document_id = await call_a3(ctx, lambda client, purchase: PurchaseStockInCapabilities(client).save_stock_in(value["payload"], request.category))
        if not document_id:
            raise ValueError("A3 保存响应缺少单据 ID，请先核实源系统结果")
        return {"success": {**value, "mode": "save", "document_id": document_id, "status": "saved"}}
