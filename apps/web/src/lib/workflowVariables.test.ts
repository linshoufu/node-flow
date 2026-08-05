import { describe, expect, it } from "vitest";
import {
  WORKFLOW_VARIABLE_NAME_ERROR,
  buildWorkflowVariableIssues,
  formatWorkflowVariableValue,
  isWorkflowVariableName,
  nextWorkflowVariableName,
  validWorkflowVariableNames,
} from "./workflowVariables";

describe("workflow variable helpers", () => {
  it("uses the same identifier rule as vars expressions", () => {
    expect(isWorkflowVariableName("baseUrl")).toBe(true);
    expect(isWorkflowVariableName("_token_2")).toBe(true);
    expect(isWorkflowVariableName("2token")).toBe(false);
    expect(isWorkflowVariableName("base-url")).toBe(false);
    expect(isWorkflowVariableName("")).toBe(false);
  });

  it("builds Chinese validation issues for invalid variable names", () => {
    expect(
      buildWorkflowVariableIssues({
        baseUrl: "https://api.example.com",
        "bad-name": "ignored",
        "2token": "ignored",
      })
    ).toEqual([
      { name: "bad-name", message: WORKFLOW_VARIABLE_NAME_ERROR },
      { name: "2token", message: WORKFLOW_VARIABLE_NAME_ERROR },
    ]);
  });

  it("returns sorted valid names for expression references", () => {
    expect(
      validWorkflowVariableNames({
        retry_count: 3,
        "bad-name": "ignored",
        baseUrl: "https://api.example.com",
      })
    ).toEqual(["baseUrl", "retry_count"]);
  });

  it("picks the next available default variable name", () => {
    expect(nextWorkflowVariableName({})).toBe("variable_1");
    expect(nextWorkflowVariableName({ variable_1: "", variable_2: "" })).toBe("variable_3");
  });

  it("formats non-string values for text inputs without losing visibility", () => {
    expect(formatWorkflowVariableValue("abc")).toBe("abc");
    expect(formatWorkflowVariableValue(null)).toBe("");
    expect(formatWorkflowVariableValue(42)).toBe("42");
    expect(formatWorkflowVariableValue({ token: "abc" })).toBe('{"token":"abc"}');
  });
});
