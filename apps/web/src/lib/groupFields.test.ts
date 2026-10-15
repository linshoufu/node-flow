import { describe, expect, it } from "vitest";
import { groupFieldsFromConfig, withCommonGroupFields } from "./groupFields";

describe("common group field compatibility", () => {
  it("preserves old header projection, nullable values and difference policies", () => {
    const config = { by: ["key", "optional"], header_fields: ["key", "currency"], optional_keys: ["optional"], unique_items: ["sku"] };
    const fields = groupFieldsFromConfig(config);
    expect(fields).toEqual([
      { name: "key", on_difference: "split", allow_empty: false, emit: true },
      { name: "currency", on_difference: "error", allow_empty: true, emit: true },
      { name: "optional", on_difference: "split", allow_empty: true, emit: false },
    ]);
    expect(withCommonGroupFields(config, fields)).toEqual({ common_fields: fields, unique_items: ["sku"] });
    expect(config.by).toEqual(["key", "optional"]);
  });
  it("treats explicit rules, including an empty list, as authoritative", () => {
    expect(groupFieldsFromConfig({ common_fields: [], by: ["old"] })).toEqual([]);
  });
});
