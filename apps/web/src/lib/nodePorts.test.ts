import { describe, expect, it } from "vitest";
import type { NodeType, WorkflowNode } from "../types";
import { dynamicPortConfigurationIssues, resolveNodeInputPorts, resolveNodeOutputPorts } from "./nodePorts";

const switchType: NodeType = {
  id: "logic.switch",
  name: "Switch",
  category: "logic",
  description: "Route values.",
  inputs: { input: {} },
  outputs: { fallback: { displayName: "未匹配" } },
  dynamicOutputs: {
    configKey: "rules",
    idKey: "id",
    labelKey: "label",
    output: { description: "命中的输入" },
  },
  configSchema: { type: "object", properties: {} },
};

function switchNode(rules: unknown): WorkflowNode {
  return {
    id: "switch",
    type: "logic.switch",
    position: { x: 0, y: 0 },
    config: { rules },
  };
}

describe("resolveNodeOutputPorts", () => {
  it("keeps static fallback ports and adds configured route ports", () => {
    expect(resolveNodeOutputPorts(switchNode([{ id: "matched", label: "命中目标" }]), switchType)).toEqual({
      fallback: { displayName: "未匹配" },
      matched: { description: "命中的输入", displayName: "命中目标" },
    });
  });

  it("ignores invalid, duplicate, and static-port-colliding route ids", () => {
    expect(
      resolveNodeOutputPorts(
        switchNode([
          { id: "fallback", label: "不能覆盖" },
          { id: "invalid-port", label: "无效" },
          { id: "matched", label: "首次名称" },
          { id: "matched", label: "重复名称" },
        ]),
        switchType
      )
    ).toEqual({
      fallback: { displayName: "未匹配" },
      matched: { description: "命中的输入", displayName: "首次名称" },
    });
  });

  it("falls back to static ports when route configuration is unavailable", () => {
    expect(resolveNodeOutputPorts(switchNode({}), switchType)).toEqual(switchType.outputs);
  });
});

describe("resolveNodeInputPorts", () => {
  it("keeps static inputs and adds configured named inputs", () => {
    const collectType: NodeType = {
      ...switchType,
      id: "data.collect",
      inputs: { options: { required: false } },
      outputs: { output: {} },
      dynamicInputs: {
        configKey: "sources",
        idKey: "id",
        labelKey: "label",
        input: { required: true },
      },
    };
    const collectNode: WorkflowNode = {
      ...switchNode([]),
      type: "data.collect",
      config: { sources: [{ id: "left", label: "左侧结果" }] },
    };

    expect(resolveNodeInputPorts(collectNode, collectType)).toEqual({
      options: { required: false },
      left: { required: true, displayName: "左侧结果" },
    });
  });

  it("ignores invalid, duplicate, and static-port-colliding dynamic input ids", () => {
    const collectType: NodeType = {
      ...switchType,
      id: "data.collect",
      inputs: { input: {} },
      dynamicInputs: { configKey: "sources", idKey: "id", labelKey: "label", input: {} },
    };
    const collectNode: WorkflowNode = {
      ...switchNode([]),
      type: "data.collect",
      config: { sources: [{ id: "input", label: "Collision" }, { id: "bad-id", label: "Bad" }, { id: "left", label: "Left" }] },
    };

    expect(resolveNodeInputPorts(collectNode, collectType)).toEqual({ input: {}, left: { displayName: "Left" } });
  });
});

describe("dynamicPortConfigurationIssues", () => {
  it("reports malformed, duplicate, colliding, and blank dynamic port configuration", () => {
    const collectType: NodeType = {
      ...switchType,
      id: "data.collect",
      inputs: { reserved: {} },
      dynamicInputs: { configKey: "sources", idKey: "id", labelKey: "label", input: {} },
    };
    const collectNode: WorkflowNode = {
      ...switchNode([]),
      type: "data.collect",
      config: {
        sources: [
          { id: "bad-id", label: "Bad" },
          { id: "reserved", label: "Collision" },
          { id: "same", label: "First" },
          { id: "same", label: "Second" },
          { id: "blank", label: " " },
        ],
      },
    };

    expect(dynamicPortConfigurationIssues(collectNode, collectType)).toEqual([
      { field: "sources", message: "第 1 个动态输入端口 ID 必须使用字母、数字或下划线。" },
      { field: "sources", message: "动态输入端口 ID reserved 与已有端口重复。" },
      { field: "sources", message: "动态输入端口 ID same 与已有端口重复。" },
      { field: "sources", message: "第 5 个动态输入端口名称不能为空。" },
    ]);
  });
});
