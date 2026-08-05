import { describe, expect, it } from "vitest";
import type { NodeType } from "../types";
import { nodePortContractSummary } from "./nodePortSummary";

describe("nodePortContractSummary", () => {
  it("summarizes trigger nodes with zero inputs and declared outputs", () => {
    expect(
      nodePortContractSummary(
        nodeType({
          group: "trigger",
          inputs: {},
          outputs: { success: { description: "Initial payload" } },
        })
      )
    ).toEqual({
      labels: ["触发器", "输入 0", "输出 1"],
      searchText: "触发器 输入 0 输出 1",
      text: "触发器 · 输入 0 · 输出 1",
    });
  });

  it("summarizes required and multi-connection input contracts", () => {
    expect(
      nodePortContractSummary(
        nodeType({
          group: "action",
          inputs: {
            config: { required: true, description: "Required config" },
            items: { maxConnections: null, description: "Many items" },
          },
          outputs: {
            success: { description: "Success" },
            error: { description: "Error" },
          },
        })
      )
    ).toEqual({
      labels: ["动作", "输入 2", "输出 2", "必填输入 1", "支持多连接"],
      searchText: "动作 输入 2 输出 2 必填输入 1 支持多连接",
      text: "动作 · 输入 2 · 输出 2 · 必填输入 1 · 支持多连接",
    });
  });

  it("summarizes bounded multi-connection inputs", () => {
    expect(
      nodePortContractSummary(
        nodeType({
          group: "control",
          inputs: {
            input: { maxConnections: 3 },
          },
          outputs: {
            done: {},
          },
        })
      ).labels
    ).toEqual(["控制节点", "输入 1", "输出 1", "支持多连接"]);
  });
  it("includes product-facing port display names in summaries and search text", () => {
    const summary = nodePortContractSummary(
      nodeType({
        inputs: {
          body: { displayName: "请求体", required: true },
          headers: { displayName: "请求头" },
        },
        outputs: {
          success: { displayName: "响应" },
          error: { displayName: "错误" },
        },
      })
    );

    expect(summary.text).toContain("输入：请求体、请求头");
    expect(summary.text).toContain("输出：响应、错误");
    expect(summary.searchText).toContain("请求体 请求头 响应 错误");
  });

  it("describes default dynamic input ports in the node library summary", () => {
    const summary = nodePortContractSummary(
      nodeType({
        dynamicInputs: {
          configKey: "sources",
          idKey: "id",
          labelKey: "label",
          input: { required: true },
          defaultItems: [
            { id: "input_1", label: "输入 1" },
            { id: "input_2", label: "输入 2" },
          ],
        },
      })
    );

    expect(summary.labels).toEqual(["动作", "输入 2", "输出 0", "必填输入 2", "可配置输入"]);
    expect(summary.text).toContain("输入：输入 1、输入 2");
    expect(summary.searchText).toContain("可配置输入 输入 1 输入 2");
  });
});

function nodeType(overrides: Partial<NodeType>): NodeType {
  return {
    id: "demo.node",
    name: "Demo",
    category: "Demo",
    description: "Demo node",
    inputs: {},
    outputs: {},
    configSchema: { type: "object" },
    ...overrides,
  };
}
