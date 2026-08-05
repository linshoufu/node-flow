import { describe, expect, it } from "vitest";
import type { JsonSchema, NodeForm } from "../types";
import { isNodeFormVisible, resolveNodeForm } from "./nodeForm";

const schema: JsonSchema = {
  type: "object",
  properties: {
    method: { type: "string" },
    body: {},
    credential_id: { type: "string" },
  },
};

const form: NodeForm = {
  groups: [
    {
      id: "request",
      label: "请求",
      fields: [{ key: "method", control: "select", options: [{ value: "GET", label: "GET" }] }],
    },
    {
      id: "content",
      label: "内容",
      fields: [
        {
          key: "body",
          control: "json",
          visibleWhen: { field: "method", oneOf: ["POST", "PUT"] },
        },
      ],
    },
  ],
};

describe("node form contract", () => {
  it("shows a field only when its controller matches one_of", () => {
    expect(isNodeFormVisible({ field: "method", oneOf: ["POST", "PUT"] }, { method: "POST" })).toBe(true);
    expect(isNodeFormVisible({ field: "method", oneOf: ["POST", "PUT"] }, { method: "GET" })).toBe(false);
  });

  it("supports equals and not_empty conditions", () => {
    expect(isNodeFormVisible({ field: "method", equals: "GET" }, { method: "GET" })).toBe(true);
    expect(isNodeFormVisible({ field: "credential_id", notEmpty: true }, { credential_id: "cred_1" })).toBe(true);
    expect(isNodeFormVisible({ field: "credential_id", notEmpty: true }, { credential_id: "" })).toBe(false);
  });

  it("rejects a form field absent from configSchema", () => {
    const invalidForm: NodeForm = {
      groups: [{ id: "invalid", label: "无效", fields: [{ key: "missing", control: "text" }] }],
    };

    expect(resolveNodeForm(invalidForm, schema)).toBeNull();
  });

  it("rejects an unsupported expression mode from untrusted API metadata", () => {
    const invalidForm: NodeForm = {
      groups: [
        {
          id: "invalid-expression",
          label: "无效",
          fields: [{ key: "method", control: "text", expression: "unsupported" as never }],
        },
      ],
    };

    expect(resolveNodeForm(invalidForm, schema)).toBeNull();
  });

  it("keeps valid groups and tracks schema fields that need fallback rendering", () => {
    expect(resolveNodeForm(form, schema)).toEqual({
      groups: form.groups,
      fallbackFieldKeys: ["credential_id"],
    });
  });

  it("accepts the dynamic output list control for a declared configuration field", () => {
    const dynamicForm: NodeForm = {
      groups: [{ id: "routes", label: "路由规则", fields: [{ key: "body", control: "dynamic_output_list" }] }],
    };

    expect(resolveNodeForm(dynamicForm, schema)).toEqual({
      groups: dynamicForm.groups,
      fallbackFieldKeys: ["method", "credential_id"],
    });
  });

  it("accepts the dynamic input list control for a declared configuration field", () => {
    const dynamicForm: NodeForm = {
      groups: [{ id: "sources", label: "命名输入", fields: [{ key: "body", control: "dynamic_input_list" }] }],
    };

    expect(resolveNodeForm(dynamicForm, schema)).toEqual({
      groups: dynamicForm.groups,
      fallbackFieldKeys: ["method", "credential_id"],
    });
  });
});
