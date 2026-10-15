import { describe, expect, it } from "vitest";
import { parameterInput } from "./runParameters";

describe("run parameter form", () => {
  it("converts entered values into typed invocation input", () => {
    expect(parameterInput([{ name: "count", type: "integer" }, { name: "save", type: "boolean" }, { name: "data", type: "json" }], { count: "2", save: "false", data: '{"id":1}' })).toEqual({ count: 2, save: false, data: { id: 1 } });
  });
  it("rejects missing values and invalid numbers before launching", () => {
    expect(() => parameterInput([{ name: "path" }], {})).toThrow("请填写");
    expect(() => parameterInput([{ name: "count", type: "integer" }], { count: "1.5" })).toThrow("有效数字");
  });
  it("maps fields into the same source path used by external triggers", () => {
    expect(parameterInput([{ name: "code" }], { code: "order-1" }, "body.parameters")).toEqual({ body: { parameters: { code: "order-1" } } });
  });
});
