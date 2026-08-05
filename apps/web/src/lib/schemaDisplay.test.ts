import { describe, expect, it } from "vitest";
import { inputCapacityLabel, portDataModeLabel, portTooltip, schemaSummary } from "./schemaDisplay";

const httpResponseSchema = {
  type: "object",
  properties: {
    status_code: { type: "integer", minimum: 100, maximum: 599 },
    headers: { type: "object", additionalProperties: { type: "string" } },
    body: { description: "Any JSON-compatible value." },
  },
  required: ["status_code", "headers", "body"],
};

describe("schemaDisplay", () => {
  it("uses Chinese fallback labels for common technical port handles", () => {
    expect(
      portTooltip({
        direction: "output",
        name: "success",
        port: {
          description: "正常输出",
        },
      })
    ).toBe("输出端口 成功 · 任意 · 正常输出");
    expect(
      portTooltip({
        direction: "output",
        name: "failed",
        port: {
          description: "断言失败",
        },
      })
    ).toBe("输出端口 失败 · 任意 · 断言失败");
    expect(
      portTooltip({
        direction: "input",
        name: "input",
        port: {},
      })
    ).toBe("输入端口 输入 · 任意");
  });

  it("summarizes object schemas with fields and required fields", () => {
    expect(schemaSummary(httpResponseSchema)).toEqual({
      typeLabel: "object",
      fieldLabel: "字段：status_code, headers, body",
      requiredLabel: "必填：status_code, headers, body",
    });
  });

  it("summarizes array item types", () => {
    expect(schemaSummary({ type: "array", items: { type: "object" } })).toEqual({
      typeLabel: "array<object>",
    });
  });

  it("keeps unknown schemas readable", () => {
    expect(schemaSummary(undefined)).toEqual({ typeLabel: "任意" });
    expect(schemaSummary({ description: "Any JSON-compatible value." })).toEqual({ typeLabel: "任意" });
  });

  it("builds readable port hover text", () => {
    expect(
      portTooltip({
        direction: "output",
        name: "success",
        port: {
          description: "响应数据",
          schema: httpResponseSchema,
        },
      })
    ).toBe("输出端口 成功 · object · 响应数据 · 字段：status_code, headers, body · 必填：status_code, headers, body");
  });
  it("prefers port display names in hover text", () => {
    expect(
      portTooltip({
        direction: "input",
        name: "body",
        port: {
          displayName: "请求体",
          description: "JSON 请求体",
          required: true,
          schema: { type: "object" },
        },
      })
    ).toBe("输入端口 请求体 · object · JSON 请求体");
  });
  it("describes a non-data connection kind in port hover text", () => {
    expect(
      portTooltip({
        direction: "output",
        name: "success",
        port: {
          connectionKind: "resource",
        },
      })
    ).toBe("输出端口 成功 · 任意 · 通道：资源");
  });
});

describe("portTooltip connection capacity", () => {
  it("labels an item-aware input port", () => {
    expect(portDataModeLabel({ dataMode: "items" })).toBe("数据：多条 item");
    expect(portDataModeLabel({})).toBeNull();
  });

  it("describes item-aware input ports in Chinese", () => {
    expect(
      portTooltip({
        direction: "input",
        name: "items",
        port: {
          dataMode: "items",
        },
      })
    ).toBe("输入端口 items · 任意 · 数据：多条 item");
  });

  it("describes an explicit output connection limit without restricting default fan-out", () => {
    expect(inputCapacityLabel("output", {})).toBeNull();
    expect(inputCapacityLabel("output", { maxConnections: 2 })).toBe("最多 2 条下游连接");
  });

  it("describes multi-connection input capacity in port hover text", () => {
    expect(
      portTooltip({
        direction: "input",
        name: "items",
        port: {
          description: "Rows",
          maxConnections: null,
        },
      })
    ).toBe("输入端口 items · 任意 · Rows · 不限连接");

    expect(
      portTooltip({
        direction: "input",
        name: "items",
        port: {
          maxConnections: 3,
        },
      })
    ).toBe("输入端口 items · 任意 · 最多 3 条连接");
  });
});
