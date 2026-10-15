"""Configurable, file-independent record preparation and object composition."""
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from nodeflow_sdk import BaseNode, NodeConfig, NodeContext, Input, Output, node, NodeForm, FormGroup, FormField
from nodeflow_sdk.data_recipes import DataExpression, run_rules, json_value, decimal, iso_date
from nodeflow_sdk.datasets import RecordDataset
from nodeflow_sdk.loops import LOOP_RESULTS_SCHEMA
from nodes.builtin._schemas import ANY_JSON_SCHEMA


class Rule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1)
    expression: str = ""
    each: str = ""
    rules: list["Rule"] = Field(default_factory=list)
    fields: list["Rule"] = Field(default_factory=list)


class ColumnRule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    expression: str
    type: Literal["string", "decimal", "date", "object"] = "string"
    required: bool = False
    minimum: str | None = None


class PrepareConfig(NodeConfig):
    columns: list[ColumnRule] = Field(default_factory=list)
    options: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def unique_columns(self):
        if len({column.name for column in self.columns}) != len(self.columns):
            raise ValueError("目标字段名不能重复")
        return self


def form(*fields):
    return NodeForm(groups=(FormGroup("rules", "数据规则", fields=fields),))


@node(id="data.records_prepare", documentation_url="/docs/nodes/index.html#data.records_prepare", name="字段映射与校验", category="Data", icon="table",
      description="配置字段来源、类型转换、默认值、字典查找和校验；保留来源行及错误。",
      form=form(FormField("columns", control="column_rules", label="字段规则", expression="disabled")))
class RecordsPrepareNode(BaseNode[PrepareConfig]):
    effect = "pure"
    preview_support = "execute"
    resolve_config_expressions = False
    inputs = {"dataset": Input(display_name="表格数据", schema=ANY_JSON_SCHEMA),
              "options": Input(display_name="映射选项", required=False, schema=ANY_JSON_SCHEMA)}
    outputs = {"success": Output(display_name="校验记录（含错误）", schema=ANY_JSON_SCHEMA)}

    async def execute(self, ctx: NodeContext, inputs: dict):
        dataset = RecordDataset.model_validate(inputs["dataset"])
        records = []
        for row, line in zip(dataset.rows, dataset.line_numbers, strict=True):
            values, errors = {}, []
            scope = {"row": {k: v.strip() if isinstance(v, str) else v for k, v in row.items()}, "options": inputs.get("options", self.config.options)}
            engine = DataExpression()
            for rule in self.config.columns:
                try:
                    value = engine.evaluate(rule.expression, {**scope, "values": values})
                    if rule.required and value in (None, ""):
                        raise ValueError("必填字段为空")
                    if value not in (None, ""):
                        if rule.type == "decimal":
                            value = decimal(value)
                            if rule.minimum is not None and value < decimal(rule.minimum):
                                raise ValueError(f"不能小于 {rule.minimum}")
                        elif rule.type == "date":
                            value = iso_date(value)
                        elif rule.type == "string":
                            value = str(value)
                        elif not isinstance(value, dict):
                            raise ValueError("应为对象")
                    values[rule.name] = json_value(value)
                except (ValueError, TypeError, KeyError, ArithmeticError, SyntaxError) as exc:
                    values[rule.name] = None
                    errors.append({"field": rule.name, "message": str(exc), "line_number": line})
            records.append({"values": values, "line_number": line, "errors": errors})
        return {"success": {"records": records}}


class CommonField(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1)
    label: str = ""
    on_difference: Literal["split", "error"] = "split"
    allow_empty: bool = False
    emit: bool = True

    @model_validator(mode="after")
    def valid_name(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("公共字段名称不能为空")
        return self


def merge_group_fields(config):
    """Preserve the v1 partition, nullable values and exact header projection."""
    if config.get("common_fields") is not None:
        return config["common_fields"]
    by = config.get("by") or []
    headers = config.get("header_fields") or []
    optional = set(config.get("optional_keys") or [])
    return [{"name": name, "on_difference": "split" if name in by else "error",
             "allow_empty": name in optional if name in by else True, "emit": name in headers}
            for name in dict.fromkeys([*headers, *by])]


class GroupConfig(NodeConfig):
    common_fields: list[CommonField] | None = None
    unique_items: list[str] = Field(default_factory=list)
    # Additive compatibility inputs: old bindings continue resolving to these keys.
    # The primary form only authors common_fields; absent common_fields uses v1 semantics.
    by: list[str] | None = Field(default=None, json_schema_extra={"deprecated": True})
    header_fields: list[str] | None = Field(default=None, json_schema_extra={"deprecated": True})
    optional_keys: list[str] | None = Field(default=None, json_schema_extra={"deprecated": True})

    @model_validator(mode="after")
    def common_rules(self):
        if self.common_fields is None:
            self.common_fields = [CommonField.model_validate(field) for field in merge_group_fields(self.model_dump())]
        else:
            self.by = self.header_fields = self.optional_keys = None
        if len({field.name for field in self.common_fields}) != len(self.common_fields):
            raise ValueError("公共字段名称不能重复")
        return self


@node(id="data.records_group", documentation_url="/docs/nodes/index.html#data.records_group", name="分组聚合", category="Data", icon="table",
      description="用一份公共字段规则配置差异拆组或一致性检查；同组任意行无效时整组拒绝。",
      form=form(FormField("common_fields", control="group_fields", label="公共字段", expression="disabled"),
                FormField("unique_items", control="string_list", label="组内不可重复字段", expression="disabled")))
class RecordsGroupNode(BaseNode[GroupConfig]):
    effect = "pure"
    preview_support = "execute"
    inputs = {"records": Input(display_name="校验记录", schema=ANY_JSON_SCHEMA)}
    outputs = {"success": Output(display_name="分组数据", schema={"type": "array", "items": {"type": "object"}}),
               "failures": Output(display_name="输入校验失败", schema={"type": "array", "items": {"type": "object"}})}

    async def execute(self, ctx: NodeContext, inputs: dict):
        import json
        groups, failures, success = {}, [], []
        fields = self.config.common_fields
        if any(value is not None for value in (self.config.by, self.config.header_fields, self.config.optional_keys)) and not self.config.by:
            raise ValueError("旧版配置需要至少一个分组字段")
        if not fields:
            raise ValueError("请配置至少一个公共字段")
        split = [field for field in fields if field.on_difference == "split"]
        for record in inputs["records"]["records"]:
            values = record["values"]
            missing = [field.name for field in split if field.name not in values or (values[field.name] in (None, "") and not field.allow_empty)]
            if missing:
                failures.append({"line_numbers": [record["line_number"]], "errors": record["errors"] or [{"message": f"分组字段为空：{missing}"}]})
                continue
            key = json.dumps([values[field.name] for field in split], sort_keys=True, ensure_ascii=False)
            groups.setdefault(key, []).append(record)
        for ordinal, records in enumerate(groups.values(), 1):
            first = records[0]["values"]
            errors = [error for record in records for error in record["errors"]]
            for field in self.config.unique_items:
                keys = [json.dumps(record["values"].get(field), sort_keys=True) for record in records]
                if len(keys) != len(set(keys)):
                    errors.append({"message": f"同组字段重复：{field}"})
            for record in records:
                for field in fields:
                    value = record["values"].get(field.name)
                    if not field.allow_empty and value in (None, ""):
                        errors.append({"field": field.name, "line_number": record["line_number"], "message": f"公共字段不能为空：{field.label or field.name}"})
                    elif field.on_difference == "error" and value != first.get(field.name):
                        errors.append({"field": field.name, "line_number": record["line_number"], "message": f"同组公共字段不一致：{field.label or field.name}"})
            lines = [record["line_number"] for record in records]
            if errors:
                failures.append({"ordinal": ordinal, "line_numbers": lines, "errors": errors})
            else:
                success.append({"ordinal": ordinal, "header": {field.name: first.get(field.name) for field in fields if field.emit},
                                "items": [record["values"] for record in records], "line_numbers": lines})
        return {"success": success, "failures": failures}


class ComposeConfig(NodeConfig):
    rules: list[Rule] = Field(default_factory=list)
    fields: list[Rule] = Field(default_factory=list)
    output: str = "inputs"


@node(id="data.compose", documentation_url="/docs/nodes/index.html#data.compose", name="对象组装与计算", category="Data", icon="package",
      description="显式输入驱动的字段映射、唯一匹配、集合映射和精确计算，无网络或隐藏运行状态。",
      form=form(FormField("rules", control="mapping_rules", label="字段与集合规则", expression="disabled"),
                FormField("fields", control="mapping_rules", label="输出对象字段（配置后优先使用）", expression="disabled"),
                FormField("output", control="textarea", label="输出表达式", expression="disabled")))
class ComposeNode(BaseNode[ComposeConfig]):
    effect = "pure"
    preview_support = "execute"
    resolve_config_expressions = False
    inputs = {"input": Input(display_name="输入数据", required=False, schema=ANY_JSON_SCHEMA),
              "context": Input(display_name="关联数据", required=False, schema=ANY_JSON_SCHEMA),
              "options": Input(display_name="组装选项", required=False, schema=ANY_JSON_SCHEMA)}
    outputs = {"success": Output(display_name="组装结果", schema=ANY_JSON_SCHEMA)}

    async def execute(self, ctx: NodeContext, inputs: dict[str, Any]):
        engine = DataExpression()
        scope = run_rules([rule.model_dump() for rule in self.config.rules], {"inputs": inputs}, engine)
        if self.config.fields:
            fields = [rule.model_dump() for rule in self.config.fields]
            scope = run_rules(fields, scope, engine)
            return {"success": json_value({field["name"]: scope[field["name"]] for field in fields})}
        return {"success": json_value(engine.evaluate(self.config.output, scope))}


@node(id="data.batch_summary", documentation_url="/docs/nodes/index.html#data.batch_summary", version=2, name="批处理结果汇总", category="Data", icon="list",
      description="汇总预览、已保存单据、输入失败和执行失败；有失败时标记失败分支。")
class BatchSummaryNode(BaseNode[NodeConfig]):
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
