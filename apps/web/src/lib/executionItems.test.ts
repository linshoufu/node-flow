import { describe, expect, it } from "vitest";
import { executionItemMetadata, normalizeExecutionItems } from "./executionItems";

describe("normalizeExecutionItems", () => {
  it("wraps a single plain value as one JSON item", () => {
    expect(normalizeExecutionItems({ ok: true })).toEqual([{ json: { ok: true } }]);
  });

  it("normalizes arrays as item lists", () => {
    expect(normalizeExecutionItems([{ id: 1 }, { id: 2 }])).toEqual([{ json: { id: 1 } }, { json: { id: 2 } }]);
  });

  it("preserves structured item data and metadata", () => {
    const items = normalizeExecutionItems([
      { json: { name: "Alice" }, pairedItem: { item: 0 } },
      { json: { file: "report.txt" }, binary: { data: { mimeType: "text/plain" } } },
    ]);

    expect(items).toEqual([
      { json: { name: "Alice" }, pairedItem: { item: 0 } },
      { json: { file: "report.txt" }, binary: { data: { mimeType: "text/plain" } } },
    ]);
    expect(executionItemMetadata(items[0])).toEqual({ pairedItem: { item: 0 } });
    expect(executionItemMetadata(items[1])).toEqual({ binary: { data: { mimeType: "text/plain" } } });
  });

  it("returns no metadata for JSON-only items", () => {
    expect(executionItemMetadata({ json: { ok: true } })).toBeUndefined();
  });
});