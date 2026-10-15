"""Serializable workflow input declarations, shared by preflight and nodes."""

from datetime import date
from pathlib import Path
import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from .non_secret import assert_non_secret


class RunParameter(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    label: str = ""
    type: Literal["string", "file", "integer", "number", "boolean", "date", "json"] = "string"
    required: bool = True
    default: Any = None
    options: list[str] = Field(default_factory=list)
    description: str = ""

    @model_validator(mode="after")
    def safe_name(self):
        if self.name in {"__proto__", "constructor", "prototype", "success"}:
            raise ValueError("不支持的参数名称")
        assert_non_secret({self.name: self.default})
        return self


class RunParametersConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fields: list[RunParameter] = Field(default_factory=list)
    input_path: str = ""

    @model_validator(mode="after")
    def unique_names(self):
        names = [field.name for field in self.fields]
        if len(names) != len(set(names)):
            raise ValueError("运行参数名称不能重复")
        for field in self.fields:
            if "default" in field.model_fields_set and field.default is not None:
                validate_parameter(field, field.default)
        return self


def validate_parameter(field: RunParameter, value: Any, *, check_files: bool = False) -> Any:
    assert_non_secret(value)
    valid = True
    if field.type in {"string", "file", "date"}:
        valid = isinstance(value, str) and (not field.required or bool(value.strip()))
        if valid and field.type == "date":
            try:
                date.fromisoformat(value)
            except ValueError:
                valid = False
    elif field.type == "boolean":
        valid = isinstance(value, bool)
    elif field.type == "integer":
        valid = type(value) is int
    elif field.type == "number":
        valid = type(value) in {int, float} and math.isfinite(value)
    if not valid or (field.options and value not in field.options):
        raise ValueError(f"运行参数 {field.label or field.name} 不符合类型或选项要求")
    if check_files and field.type == "file" and value and not Path(value).is_file():
        raise ValueError(f"运行参数 {field.label or field.name} 指定的输入文件不存在")
    return value


def resolve_parameters(config: RunParametersConfig, initial_input: Any) -> dict[str, Any]:
    source = initial_input
    for key in config.input_path.split(".") if config.input_path else []:
        source = source.get(key) if isinstance(source, dict) else None
    if source is None:
        source = {}
    if not isinstance(source, dict):
        raise ValueError("运行参数输入必须是 JSON 对象")
    result = {}
    for field in config.fields:
        value = source.get(field.name, field.default)
        if value is None:
            if field.required:
                raise ValueError(f"缺少运行参数：{field.label or field.name}")
            result[field.name] = None
        else:
            result[field.name] = validate_parameter(field, value, check_files=True)
    return result
