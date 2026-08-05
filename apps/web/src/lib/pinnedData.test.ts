import { describe, expect, it } from "vitest";
import { createPinnedDataDraft, parsePinnedDataDraft } from "./pinnedData";

describe("pinned data drafts", () => {
  it("creates an editable object for the primary output port", () => {
    expect(createPinnedDataDraft(["success", "error"])).toEqual({ success: {} });
    expect(createPinnedDataDraft(["true", "false"])).toEqual({ true: {} });
  });

  it("parses a non-empty object that only uses declared output ports", () => {
    expect(parsePinnedDataDraft('{\n  "success": { "id": 42 }\n}', ["success", "error"])).toEqual({
      pinnedData: { success: { id: 42 } },
      errors: [],
    });
  });

  it("reports JSON, shape, empty, and output-port problems before saving", () => {
    expect(parsePinnedDataDraft("{", ["success"])).toEqual({
      errors: ["固定输出必须是有效的 JSON。"],
    });
    expect(parsePinnedDataDraft("[]", ["success"])).toEqual({
      errors: ["固定输出必须是一个对象，键名为输出端口。"],
    });
    expect(parsePinnedDataDraft("{}", ["success"])).toEqual({
      errors: ["固定输出至少需要包含一个输出端口。"],
    });
    expect(parsePinnedDataDraft('{"missing": true}', ["success"])).toEqual({
      errors: ["输出端口“missing”不存在。"],
    });
  });
});
