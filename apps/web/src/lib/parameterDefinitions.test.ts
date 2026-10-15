import { describe, expect, it } from "vitest";
import { changeParameterType, newParameter, parameterDefinitionIssue } from "./parameterDefinitions";

describe("parameter definition editing", () => {
  it("generates a unique reference name without changing existing fields", () => {
    const fields = [{ name: "parameter_1" }, { name: "csv_path" }, { name: "parameter_3" }];
    expect(newParameter(fields)).toMatchObject({ name: "parameter_2", type: "string", required: true });
  });

  it("preserves compatible defaults and drops invalid defaults when changing types", () => {
    expect(changeParameterType({ name: "path", type: "string", default: "data.csv" }, "file").default).toBe("data.csv");
    expect(changeParameterType({ name: "flag", type: "boolean", default: false }, "boolean").default).toBe(false);
    expect(changeParameterType({ name: "count", type: "integer", default: 0 }, "number").default).toBe(0);
    expect(changeParameterType({ name: "count", default: 1.5 }, "integer")).not.toHaveProperty("default");
    expect(changeParameterType({ name: "mode", default: "preview", options: ["preview"] }, "integer")).toEqual({ name: "mode", type: "integer" });
  });

  it("explains duplicate names and invalid option defaults before save", () => {
    const fields = [{ name: "mode" }, { name: "mode" }];
    expect(parameterDefinitionIssue(fields[0], fields, 0)).toContain("已存在");
    expect(parameterDefinitionIssue({ name: "invalid name" }, [], 0)).toContain("参数名");
    expect(parameterDefinitionIssue({ name: "password" }, [], 0)).toContain("凭据");
    expect(parameterDefinitionIssue({ name: "mode", default: "save", options: ["preview"] }, [], 0)).toContain("可选值");
    expect(parameterDefinitionIssue({ name: "mode", default: "preview", options: ["preview"] }, [], 0)).toBeNull();
  });
});
