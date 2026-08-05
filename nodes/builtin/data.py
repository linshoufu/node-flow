from __future__ import annotations

import csv
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from nodeflow_sdk import (
    BaseNode,
    DynamicInputList,
    FormCondition,
    FormField,
    FormGroup,
    Input,
    NodeConfig,
    NodeContext,
    NodeForm,
    Output,
    SelectOption,
    execution_item,
    node,
)
from nodeflow_sdk.expressions import resolve_expression

from nodes.builtin._data_utils import resolve_data_path
from nodes.builtin._schemas import ANY_JSON_SCHEMA, CSV_DATASET_SCHEMA, ERROR_SCHEMA, EXECUTION_ITEMS_SCHEMA


class CsvReadConfig(NodeConfig):
    path: str = Field(..., title="CSV file path")
    delimiter: str = Field(default=",", min_length=1, max_length=4)
    encoding: str = "utf-8"
    has_header: bool = True


@node(
    id="data.csv_read",
    name="Read CSV",
    category="Data",
    description="Read CSV rows for data-driven tests.",
    group="action",
    icon="table",
    tags=["data", "csv", "file"],
    keywords=["rows", "columns", "parameterized", "dataset"],
    documentation_url="/docs/nodes/index.html#data.csv_read",
    form=NodeForm(
        groups=(
            FormGroup(
                "file",
                "文件",
                fields=(
                    FormField("path", label="CSV 文件路径", placeholder="examples/api-cases.csv"),
                ),
            ),
            FormGroup(
                "parse",
                "解析",
                fields=(
                    FormField("delimiter", label="分隔符", expression="disabled"),
                    FormField("encoding", label="文件编码", expression="disabled"),
                    FormField("has_header", control="switch", label="首行包含字段名"),
                ),
            ),
        )
    ),
)
class CsvReadNode(BaseNode[CsvReadConfig]):
    outputs = {
        "success": Output(display_name="数据集", description="CSV rows, headers, and columns", schema=CSV_DATASET_SCHEMA),
        "items": Output(display_name="数据项", description="One execution item per CSV row", schema=EXECUTION_ITEMS_SCHEMA),
        "error": Output(display_name="错误", category="error", description="CSV read error", schema=ERROR_SCHEMA),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        try:
            csv_path = Path(self.config.path)
            with csv_path.open("r", encoding=self.config.encoding, newline="") as file:
                if self.config.has_header:
                    reader = csv.DictReader(file, delimiter=self.config.delimiter)
                    rows = [dict(row) for row in reader]
                    headers = list(reader.fieldnames or [])
                else:
                    raw_rows = list(csv.reader(file, delimiter=self.config.delimiter))
                    column_count = max((len(row) for row in raw_rows), default=0)
                    headers = [f"column_{index + 1}" for index in range(column_count)]
                    rows = [
                        {header: row[index] if index < len(row) else "" for index, header in enumerate(headers)}
                        for row in raw_rows
                    ]
        except Exception as exc:
            return {
                "error": {
                    "message": str(exc),
                    "type": exc.__class__.__name__,
                    "path": self.config.path,
                }
            }

        columns: dict[str, list[Any]] = {header: [] for header in headers}
        for row in rows:
            for header in headers:
                columns[header].append(row.get(header, ""))

        dataset = {
                "path": str(Path(self.config.path)),
                "headers": headers,
                "rows": rows,
                "columns": columns,
                "items": [execution_item(row, paired_item={"item": index}) for index, row in enumerate(rows)],
                "row_count": len(rows),
        }
        return {"success": dataset, "items": dataset["items"]}


class ExtractConfig(NodeConfig):
    path: str = Field(..., title="Input data path")


@node(
    id="data.extract",
    name="Extract Value",
    category="Data",
    description="Extract a value from input data.",
    group="action",
    icon="braces",
    tags=["data", "utility"],
    keywords=["path", "json", "field", "select"],
    documentation_url="/docs/nodes/index.html#data.extract",
    form=NodeForm(
        groups=(
            FormGroup(
                "extract",
                "提取",
                fields=(
                    FormField("path", label="数据路径", placeholder="body.user.id"),
                ),
            ),
        )
    ),
)
class ExtractNode(BaseNode[ExtractConfig]):
    inputs = {"input": Input(display_name="数据", required=True, description="Source data", schema=ANY_JSON_SCHEMA)}
    outputs = {
        "success": Output(display_name="提取值", description="Extracted value", schema=ANY_JSON_SCHEMA),
        "error": Output(display_name="错误", category="error", description="Extract error", schema=ERROR_SCHEMA),
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        try:
            return {"success": resolve_data_path(inputs.get("input"), self.config.path)}
        except Exception as exc:
            return {
                "error": {
                    "message": str(exc),
                    "type": exc.__class__.__name__,
                    "path": self.config.path,
                }
            }


class MapItemsConfig(NodeConfig):
    value: Any = Field(..., title="Item value expression")


@node(
    id="data.map_items",
    name="Map Items",
    category="Data",
    description="Build a new value for every incoming execution item.",
    group="action",
    icon="wand",
    tags=["data", "items", "transform"],
    keywords=["map", "items", "fields", "transform"],
    documentation_url="/docs/nodes/index.html#data.map_items",
    form=NodeForm(
        groups=(
            FormGroup(
                "mapping",
                "映射",
                fields=(
                    FormField("value", control="textarea", label="映射结果", placeholder='{"id": "{{ item.id }}"}'),
                ),
            ),
        )
    ),
)
class MapItemsNode(BaseNode[MapItemsConfig]):
    resolve_config_expressions = False
    inputs = {
        "items": Input(
            display_name="数据项",
            required=True,
            description="Execution items to map",
            data_mode="items",
        )
    }
    outputs = {
        "items": Output(
            display_name="数据项",
            description="Mapped execution items",
            schema=EXECUTION_ITEMS_SCHEMA,
        )
    }

    async def execute(self, ctx: NodeContext, inputs: dict[str, Any]) -> dict[str, Any]:
        return {
            "items": [
                _replace_item_json(item, resolve_expression(self.config.value, _item_context(ctx, item)))
                for item in inputs["items"]
            ]
        }


class FilterItemsConfig(NodeConfig):
    value_expression: Any = Field(..., title="Item value expression")
    operator: Literal["equals", "not_equals", "exists", "is_empty", "is_not_empty"] = "equals"
    expected_value: Any = Field(default=None, title="Expected value")


FILTER_OPERATOR_OPTIONS = (
    SelectOption("equals", "等于"),
    SelectOption("not_equals", "不等于"),
    SelectOption("exists", "存在"),
    SelectOption("is_empty", "为空"),
    SelectOption("is_not_empty", "不为空"),
)
FILTER_EXPECTED_VALUE_CONDITION = FormCondition("operator", one_of=("equals", "not_equals"))


@node(
    id="data.filter_items",
    name="Filter Items",
    category="Data",
    description="Keep execution items that match a field comparison.",
    group="action",
    icon="filter",
    tags=["data", "items", "filter"],
    keywords=["filter", "items", "condition", "match"],
    documentation_url="/docs/nodes/index.html#data.filter_items",
    form=NodeForm(
        groups=(
            FormGroup(
                "filter",
                "筛选条件",
                fields=(
                    FormField("value_expression", control="textarea", label="待比较值", placeholder="{{ item.enabled }}", expression="required"),
                    FormField("operator", control="select", label="比较方式", options=FILTER_OPERATOR_OPTIONS),
                    FormField(
                        "expected_value",
                        control="textarea",
                        label="期望值",
                        visible_when=FILTER_EXPECTED_VALUE_CONDITION,
                    ),
                ),
            ),
        )
    ),
)
class FilterItemsNode(BaseNode[FilterItemsConfig]):
    resolve_config_expressions = False
    inputs = {
        "items": Input(
            display_name="数据项",
            required=True,
            description="Execution items to filter",
            data_mode="items",
        )
    }
    outputs = {
        "items": Output(
            display_name="匹配项",
            description="Items that match the configured comparison",
            schema=EXECUTION_ITEMS_SCHEMA,
        )
    }

    async def execute(self, ctx: NodeContext, inputs: dict[str, Any]) -> dict[str, Any]:
        return {
            "items": [
                item
                for item in inputs["items"]
                if _item_matches_filter(self.config, ctx, item)
            ]
        }


@node(
    id="data.merge_items",
    name="Merge Items",
    category="Data",
    description="Append item streams from multiple upstream nodes.",
    group="action",
    icon="merge",
    tags=["data", "items", "merge"],
    keywords=["merge", "append", "combine", "items"],
    documentation_url="/docs/nodes/index.html#data.merge_items",
)
class MergeItemsNode(BaseNode[NodeConfig]):
    inputs = {
        "items": Input(
            display_name="数据项",
            required=True,
            description="Item streams to append in arrival order",
            data_mode="items",
            max_connections=None,
        )
    }
    outputs = {
        "items": Output(
            display_name="合并结果",
            description="Appended execution items",
            schema=EXECUTION_ITEMS_SCHEMA,
        )
    }

    async def execute(self, ctx: NodeContext, inputs: dict[str, Any]) -> dict[str, Any]:
        return {"items": list(inputs["items"])}


class NamedInputPort(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    label: str = Field(min_length=1, max_length=80)

    @field_validator("id", "label")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return value.strip()


class CollectInputsConfig(NodeConfig):
    sources: list[NamedInputPort] = Field(
        default=[
            {"id": "input_1", "label": "输入 1"},
            {"id": "input_2", "label": "输入 2"},
        ],
        min_length=1,
        max_length=12,
    )

    @model_validator(mode="after")
    def require_unique_source_ids(self) -> "CollectInputsConfig":
        source_ids = [source.id for source in self.sources]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("Each named input port id must be unique")
        return self


@node(
    id="data.collect",
    name="Collect Inputs",
    category="Data",
    description="Collect values from configurable named input ports into one object.",
    group="action",
    icon="combine",
    tags=["data", "merge", "collect", "parallel"],
    keywords=["collect", "named", "input", "combine", "parallel"],
    documentation_url="/docs/nodes/index.html#data.collect",
    dynamic_inputs=DynamicInputList(
        config_key="sources",
        input=Input(required=True, description="Named value to collect", schema=ANY_JSON_SCHEMA),
        default_items=(
            {"id": "input_1", "label": "输入 1"},
            {"id": "input_2", "label": "输入 2"},
        ),
    ),
    form=NodeForm(
        groups=(
            FormGroup(
                "sources",
                "输入端口",
                fields=(
                    FormField(
                        "sources",
                        control="dynamic_input_list",
                        label="命名输入",
                        description="为每个上游值创建一个具名输入端口；名称会立即同步到画布。",
                        expression="disabled",
                    ),
                ),
            ),
        )
    ),
)
class CollectInputsNode(BaseNode[CollectInputsConfig]):
    outputs = {
        "output": Output(
            display_name="汇聚结果",
            description="Object keyed by the configured input port names",
            schema=ANY_JSON_SCHEMA,
        )
    }

    @classmethod
    def input_ports(cls, config: dict[str, Any] | CollectInputsConfig | None = None) -> dict[str, Input]:
        parsed = config if isinstance(config, CollectInputsConfig) else CollectInputsConfig.model_validate(config or {})
        return {
            source.id: Input(
                required=True,
                display_name=source.label,
                description="Named value to collect",
                schema=ANY_JSON_SCHEMA,
            )
            for source in parsed.sources
        }

    async def execute(self, ctx: NodeContext, inputs: dict[str, Any]) -> dict[str, Any]:
        return {"output": inputs}


def _item_context(ctx: NodeContext, item: dict[str, Any]) -> dict[str, Any]:
    return {**ctx.data, "item": item["json"]}


def _replace_item_json(item: dict[str, Any], value: Any) -> dict[str, Any]:
    result = {"json": value}
    for key in ("binary", "pairedItem"):
        if key in item:
            result[key] = item[key]
    return result


def _item_matches_filter(config: FilterItemsConfig, ctx: NodeContext, item: dict[str, Any]) -> bool:
    value = resolve_expression(config.value_expression, _item_context(ctx, item))
    expected_value = resolve_expression(config.expected_value, _item_context(ctx, item))
    if config.operator == "equals":
        return value == expected_value
    if config.operator == "not_equals":
        return value != expected_value
    if config.operator == "exists":
        return value is not None
    if config.operator == "is_empty":
        return value is None or value == "" or value == [] or value == {}
    return value is not None and value != "" and value != [] and value != {}
