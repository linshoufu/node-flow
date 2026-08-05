import { describe, expect, it } from "vitest";
import type { NodeType } from "../types";
import { localizeNodeType } from "./display";

describe("display localization", () => {
  it("keeps raw node metadata searchable while showing localized labels", () => {
    const localized = localizeNodeType(
      nodeType({
        category: "Network",
        tags: ["http", "api", "network"],
        keywords: ["request", "rest"],
      })
    );

    expect(localized.category).toBe("网络");
    expect(localized.tags).toEqual(["HTTP", "接口", "网络"]);
    expect(localized.keywords).toEqual(
      expect.arrayContaining(["Network", "http", "api", "network", "request", "rest", "网络", "HTTP", "接口"])
    );
  });

  it("localizes the generic Webhook trigger and its configuration fields", () => {
    const localized = localizeNodeType(
      nodeType({
        id: "webhook.trigger",
        name: "Webhook Trigger",
        category: "Triggers",
        configSchema: {
          type: "object",
          properties: {
            method: { title: "Method", type: "string" },
            path: { title: "Path", type: "string" },
          },
        },
      })
    );

    expect(localized.displayName).toBe("Webhook 触发");
    expect(localized.configSchema.properties?.method?.title).toBe("请求方法");
    expect(localized.configSchema.properties?.path?.title).toBe("路径");
  });

  it("localizes the schedule trigger and interval configuration", () => {
    const localized = localizeNodeType(
      nodeType({
        id: "schedule.trigger",
        name: "Schedule Trigger",
        category: "Triggers",
        configSchema: {
          type: "object",
          properties: {
            interval_seconds: { title: "Interval seconds", type: "integer" },
          },
        },
      })
    );

    expect(localized.displayName).toBe("定时触发");
    expect(localized.configSchema.properties?.interval_seconds?.title).toBe("间隔秒数");
  });

  it("localizes all Webhook node tags shown in the palette", () => {
    const localized = localizeNodeType(
      nodeType({
        id: "webhook.respond",
        name: "Webhook Response",
        category: "Triggers",
        tags: ["webhook", "http", "response"],
      }),
    );

    expect(localized.tags).toEqual(["Webhook", "HTTP", "响应"]);
  });

  it("localizes built-in port descriptions for the canvas and port tooltips", () => {
    const localized = localizeNodeType(
      nodeType({
        id: "logic.if",
        name: "If",
        category: "Logic",
        inputs: { input: { displayName: "输入", description: "Source data" } },
        outputs: {
          true: { displayName: "为真", description: "Condition is truthy" },
          false: { displayName: "为假", description: "Condition is falsey" },
        },
      }),
    );

    expect(localized.inputs.input.description).toBe("来源数据");
    expect(localized.outputs.true.description).toBe("条件结果为真时输出");
    expect(localized.outputs.false.description).toBe("条件结果为假时输出");
  });

  it("uses Chinese branch wording while retaining the underlying port ids", () => {
    const localized = localizeNodeType(nodeType({ id: "logic.if", name: "If", category: "Logic" }));

    expect(localized.description).toBe("根据表达式结果走“为真”或“为假”分支。");
  });

  it("localizes dynamic route node metadata", () => {
    const localized = localizeNodeType(
      nodeType({
        id: "logic.switch",
        name: "Switch",
        category: "Logic",
        description: "Route an input value to a configured matching output.",
        inputs: { input: { displayName: "Input" } },
        outputs: { fallback: { displayName: "未匹配" } },
        dynamicOutputs: {
          configKey: "rules",
          idKey: "id",
          labelKey: "label",
          output: { description: "Matched route input" },
        },
      }),
    );

    expect(localized.displayName).toBe("路由分支");
    expect(localized.description).toBe("按配置的规则把输入路由到对应分支。");
    expect(localized.dynamicOutputs?.output.description).toBe("命中路由的输入数据");
  });

  it("adds Chinese labels for built-in enum options without changing enum values", () => {
    const localized = localizeNodeType(
      nodeType({
        id: "data.filter_items",
        name: "Filter Items",
        category: "Data",
        configSchema: {
          type: "object",
          properties: {
            operator: {
              title: "Operator",
              type: "string",
              enum: ["equals", "not_equals", "exists", "is_empty", "is_not_empty"],
            },
          },
        },
      }),
    );

    const operator = localized.configSchema.properties?.operator;
    expect(operator?.enum).toEqual(["equals", "not_equals", "exists", "is_empty", "is_not_empty"]);
    expect(operator?.enumLabels).toEqual({
      equals: "等于",
      not_equals: "不等于",
      exists: "存在",
      is_empty: "为空",
      is_not_empty: "不为空",
    });
  });

  it("将常用自动化标签显示为中文并保留英文搜索别名", () => {
    const localized = localizeNodeType(
      nodeType({
        id: "schedule.trigger",
        name: "Schedule Trigger",
        category: "Triggers",
        tags: ["trigger", "schedule", "automation"],
      }),
    );

    expect(localized.tags).toEqual(["触发", "定时", "自动化"]);
    expect(localized.keywords).toEqual(expect.arrayContaining(["schedule", "automation", "定时", "自动化"]));
  });

  it("localizes the generic Webhook response node and response header field", () => {
    const localized = localizeNodeType(
      nodeType({
        id: "webhook.respond",
        name: "Webhook Response",
        category: "Triggers",
        configSchema: {
          type: "object",
          properties: {
            headers: { title: "Headers", type: "object" },
            status_code: { title: "Status Code", type: "integer" },
          },
        },
      })
    );

    expect(localized.displayName).toBe("Webhook 响应");
    expect(localized.configSchema.properties?.headers?.title).toBe("响应头");
    expect(localized.configSchema.properties?.status_code?.title).toBe("响应状态码");
  });

  it("localizes the item loop as a general data-flow control node", () => {
    const localized = localizeNodeType(
      nodeType({
        id: "control.each_item",
        name: "Each Item",
        category: "Control",
        configSchema: { type: "object", properties: {} },
      })
    );

    expect(localized.displayName).toBe("逐项循环");
    expect(localized.description).toBe("对输入数据项逐个执行循环体。");
  });
});

it("localizes generic item data nodes for the Chinese node library", () => {
  const mapped = localizeNodeType(
    nodeType({ id: "data.map_items", name: "Map Items", category: "Data" })
  );
  const filtered = localizeNodeType(
    nodeType({ id: "data.filter_items", name: "Filter Items", category: "Data" })
  );
  const merged = localizeNodeType(
    nodeType({ id: "data.merge_items", name: "Merge Items", category: "Data" })
  );

  expect(mapped.displayName).toBe("映射数据项");
  expect(filtered.displayName).toBe("筛选数据项");
  expect(merged.displayName).toBe("合并数据项");
});

it("labels item mapping configuration as a JSON mapping", () => {
  const localized = localizeNodeType(
    nodeType({
      id: "data.map_items",
      name: "Map Items",
      category: "Data",
      configSchema: {
        type: "object",
        properties: { value: { title: "Item value expression" } },
      },
    })
  );

  expect(localized.configSchema.properties?.value?.title).toBe("映射对象");
});

function nodeType(overrides: Partial<NodeType> = {}): NodeType {
  return {
    id: "http.request",
    name: "HTTP Request",
    category: "Network",
    description: "Send an HTTP request.",
    inputs: {},
    outputs: {},
    configSchema: { type: "object", properties: {} },
    ...overrides,
  };
}
