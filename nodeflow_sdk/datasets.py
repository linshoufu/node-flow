"""File-independent tabular input shared by CSV and connector adapters."""
from typing import Any

from pydantic import BaseModel, ConfigDict, model_validator


RECORD_DATASET_SCHEMA = {
    "type": "object",
    "properties": {
        "headers": {"type": "array", "items": {"type": "string"}},
        "rows": {"type": "array", "items": {"type": "object"}},
        "line_numbers": {"type": "array", "items": {"type": "integer", "minimum": 1}},
    },
    "required": ["headers", "rows"],
}


class RecordDataset(BaseModel):
    model_config = ConfigDict(extra="ignore")
    headers: list[str]
    rows: list[dict[str, Any]]
    line_numbers: list[int] | None = None

    @model_validator(mode="after")
    def check_lines(self):
        if self.line_numbers is None:
            self.line_numbers = list(range(2, len(self.rows) + 2))
        if len(self.line_numbers) != len(self.rows) or any(line < 1 for line in self.line_numbers):
            raise ValueError("数据行与来源行号必须一一对应，行号必须为正整数")
        return self
