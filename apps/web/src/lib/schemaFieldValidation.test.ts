import { describe, expect, it } from "vitest";
import type { JsonSchema } from "../types";
import { validateSchemaField } from "./schemaFieldValidation";

describe("validateSchemaField", () => {
  it("returns a required error for empty required values", () => {
    expect(validateSchemaField({ value: "", schema: { type: "string" }, isRequired: true })).toEqual([
      "必填项不能为空",
    ]);
    expect(validateSchemaField({ value: "   ", schema: { type: "string" }, isRequired: true })).toEqual([
      "必填项不能为空",
    ]);
    expect(validateSchemaField({ value: undefined, schema: { type: "string" }, isRequired: true })).toEqual([
      "必填项不能为空",
    ]);
    expect(validateSchemaField({ value: [], schema: { type: "array", items: { type: "string" } }, isRequired: true })).toEqual([
      "必填项不能为空",
    ]);
  });

  it("validates schema type mismatches", () => {
    expect(validateSchemaField({ value: 123, schema: { type: "string" }, isRequired: false })).toEqual(["类型应为文本"]);
    expect(validateSchemaField({ value: "12", schema: { type: "number" }, isRequired: false })).toEqual(["类型应为数字"]);
    expect(validateSchemaField({ value: "true", schema: { type: "boolean" }, isRequired: false })).toEqual(["类型应为布尔值"]);
    expect(validateSchemaField({ value: { ok: true }, schema: { type: "array" }, isRequired: false })).toEqual(["类型应为数组"]);
    expect(validateSchemaField({ value: ["wrong"], schema: { type: "object" }, isRequired: false })).toEqual(["类型应为对象"]);
  });
  it("validates required properties inside object fields", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["token"],
      properties: {
        token: { type: "string", title: "Token" },
      },
    };

    expect(validateSchemaField({ value: {}, schema, isRequired: false })).toEqual(["Token：必填项不能为空"]);
  });

  it("validates array items from item schemas", () => {
    const schema: JsonSchema = {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", title: "Name", minLength: 2 },
        },
      },
    };

    expect(validateSchemaField({ value: [{ name: "A" }, {}], schema, isRequired: false })).toEqual([
      "第 1 项.Name：至少需要 2 个字符",
      "第 2 项.Name：必填项不能为空",
    ]);
  });
  it("validates local $defs references", () => {
    const schema: JsonSchema = {
      $defs: {
        Auth: {
          type: "object",
          title: "Auth",
          required: ["token"],
          properties: {
            token: { type: "string", title: "Token", minLength: 3 },
          },
        },
      },
      $ref: "#/$defs/Auth",
    };

    expect(validateSchemaField({ value: { token: "ab" }, schema, isRequired: false })).toEqual([
      "Token：至少需要 3 个字符",
    ]);
  });
  it("validates Pydantic-style optional anyOf schemas", () => {
    const schema: JsonSchema = {
      anyOf: [{ type: "string", minLength: 3 }, { type: "null" }],
    };

    expect(validateSchemaField({ value: "ab", schema, isRequired: false })).toEqual(["至少需要 3 个字符"]);
    expect(validateSchemaField({ value: null, schema, isRequired: false })).toEqual([]);
  });

  it("validates allOf schema constraints", () => {
    const schema: JsonSchema = {
      allOf: [{ type: "string" }, { minLength: 3 }],
    };

    expect(validateSchemaField({ value: "ab", schema, isRequired: false })).toEqual(["至少需要 3 个字符"]);
  });
  it("validates string length constraints", () => {
    const schema: JsonSchema = { type: "string", minLength: 3, maxLength: 5 };

    expect(validateSchemaField({ value: "ab", schema, isRequired: false })).toEqual(["至少需要 3 个字符"]);
    expect(validateSchemaField({ value: "abcdef", schema, isRequired: false })).toEqual(["最多允许 5 个字符"]);
    expect(validateSchemaField({ value: "abc", schema, isRequired: false })).toEqual([]);
  });

  it("validates numeric range constraints", () => {
    const schema: JsonSchema = { type: "number", minimum: 10, maximum: 20 };

    expect(validateSchemaField({ value: 9, schema, isRequired: false })).toEqual(["不能小于 10"]);
    expect(validateSchemaField({ value: 21, schema, isRequired: false })).toEqual(["不能大于 20"]);
    expect(validateSchemaField({ value: 12, schema, isRequired: false })).toEqual([]);
  });

  it("validates exclusive numeric range constraints", () => {
    const schema: JsonSchema = { type: "number", exclusiveMinimum: 10, exclusiveMaximum: 20 };

    expect(validateSchemaField({ value: 10, schema, isRequired: false })).toEqual(["必须大于 10"]);
    expect(validateSchemaField({ value: 20, schema, isRequired: false })).toEqual(["必须小于 20"]);
    expect(validateSchemaField({ value: 12, schema, isRequired: false })).toEqual([]);
  });

  it("validates integer fields", () => {
    expect(validateSchemaField({ value: 1.5, schema: { type: "integer" }, isRequired: false })).toEqual([
      "请输入整数",
    ]);
    expect(validateSchemaField({ value: 2, schema: { type: "integer" }, isRequired: false })).toEqual([]);
  });

  it("validates enum options", () => {
    const schema: JsonSchema = { type: "string", enum: ["GET", "POST"] };

    expect(validateSchemaField({ value: "PATCH", schema, isRequired: false })).toEqual(["请选择有效选项"]);
    expect(validateSchemaField({ value: "GET", schema, isRequired: false })).toEqual([]);
  });

  it("validates string pattern constraints", () => {
    const schema: JsonSchema = { type: "string", pattern: "^[a-z_][a-z0-9_]*$" };

    expect(validateSchemaField({ value: "User Name", schema, isRequired: false })).toEqual(["格式不正确"]);
    expect(validateSchemaField({ value: "user_name_1", schema, isRequired: false })).toEqual([]);
  });

  it("validates array length constraints", () => {
    const schema: JsonSchema = { type: "array", minItems: 2, maxItems: 3 };

    expect(validateSchemaField({ value: ["one"], schema, isRequired: false })).toEqual(["至少需要 2 项"]);
    expect(validateSchemaField({ value: ["one", "two", "three", "four"], schema, isRequired: false })).toEqual([
      "最多允许 3 项",
    ]);
    expect(validateSchemaField({ value: ["one", "two"], schema, isRequired: false })).toEqual([]);
  });

  it("validates URI-like string formats", () => {
    expect(validateSchemaField({ value: "not a url", schema: { type: "string", format: "uri" }, isRequired: false })).toEqual([
      "请输入有效 URL",
    ]);
    expect(validateSchemaField({ value: "https://example.com/users", schema: { type: "string", format: "url" }, isRequired: false })).toEqual([]);
  });

  it("validates email string formats", () => {
    const schema: JsonSchema = { type: "string", format: "email" };

    expect(validateSchemaField({ value: "alice", schema, isRequired: false })).toEqual(["请输入有效邮箱"]);
    expect(validateSchemaField({ value: "alice@example.com", schema, isRequired: false })).toEqual([]);
  });
});
