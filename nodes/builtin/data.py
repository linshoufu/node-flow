from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

from pydantic import Field

from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node

from nodes.builtin._data_utils import resolve_data_path


class CsvReadConfig(NodeConfig):
    path: str = Field(..., title="CSV file path")
    delimiter: str = Field(default=",", min_length=1, max_length=4)
    encoding: str = "utf-8"
    has_header: bool = True


@node(id="data.csv_read", name="Read CSV", category="Data", description="Read CSV rows for data-driven tests.")
class CsvReadNode(BaseNode[CsvReadConfig]):
    outputs = {
        "success": Output(description="CSV rows, headers, and columns"),
        "error": Output(description="CSV read error"),
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

        return {
            "success": {
                "path": str(Path(self.config.path)),
                "headers": headers,
                "rows": rows,
                "columns": columns,
                "row_count": len(rows),
            }
        }


class ExtractConfig(NodeConfig):
    path: str = Field(..., title="Input data path")


@node(id="data.extract", name="Extract Value", category="Data", description="Extract a value from input data.")
class ExtractNode(BaseNode[ExtractConfig]):
    inputs = {"input": Input(required=True, description="Source data")}
    outputs = {
        "success": Output(description="Extracted value"),
        "error": Output(description="Extract error"),
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
