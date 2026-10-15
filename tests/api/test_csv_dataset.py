from pathlib import Path

import pytest

from nodeflow_sdk import NodeContext
from nodeflow_sdk.datasets import RecordDataset
from nodes.builtin.data import CsvReadNode


@pytest.mark.asyncio
@pytest.mark.parametrize("encoding", ["utf-8-sig", "gb18030"])
async def test_connected_path_overrides_fallback_and_preserves_source_lines(tmp_path, encoding):
    source = tmp_path / "数据.csv"
    source.write_bytes('name,value\n\n采购,"第一行\n第二行"\n末行,2\n'.encode(encoding))
    result = await CsvReadNode(config={"path": "missing-fallback.csv", "encoding": "auto"}).execute(
        NodeContext(run_id="offline", node_id="csv"), {"path": str(source)})
    dataset = RecordDataset.model_validate(result["success"])
    assert dataset.headers == ["name", "value"]
    assert dataset.rows == [{"name": "采购", "value": "第一行\n第二行"}, {"name": "末行", "value": "2"}]
    assert dataset.line_numbers == [3, 5]


@pytest.mark.asyncio
async def test_missing_path_fails_clearly_without_reading_files(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("A missing path must not read a file")
    monkeypatch.setattr(Path, "read_text", forbidden)
    result = await CsvReadNode(config={}).execute(NodeContext(run_id="offline", node_id="csv"), {})
    assert result["error"]["type"] == "ValueError"


def test_dataset_checks_source_row_alignment():
    with pytest.raises(ValueError, match="一一对应"):
        RecordDataset(headers=["id"], rows=[{"id": 1}], line_numbers=[])
