import { describe, expect, it } from "vitest";
import { buildCanvasNodeData } from "./canvasNodeData";
import type { NodeRunDetail } from "./nodeRunDetail";
import type { WorkflowIssueItem } from "./workflowIssues";
import type { NodeType, WorkflowNode } from "../types";

describe("canvas node data", () => {
  it("maps workflow nodes to product-facing canvas node data", () => {
    const data = buildCanvasNodeData({
      node: {
        id: "node_request",
        type: "http.request",
        position: { x: 80, y: 80 },
        config: { label: "登录接口请求" },
      },
      nodeType: httpRequestType,
      runDetail: nodeRunDetail(),
      runtimeState: {
        nodeId: "node_request",
        status: "succeeded",
        scopes: [[]],
      },
    });

    expect(data).toEqual(
      expect.objectContaining({
        description: "Send an HTTP request.",
        displayName: "登录接口请求",
        inputPorts: [["input", httpRequestType.inputs.input]],
        outputPorts: [["success", httpRequestType.outputs.success]],
        runtimeStatus: "succeeded",
        runtimeStatusLabel: "成功",
        subtitle: "操作",
        subtitleTitle: undefined,
      })
    );
    expect(data.runSummary?.ariaLabel).toBe("1 次执行，2 项输出，耗时 8 ms");
  });

  it("keeps missing node types readable without exposing internals as primary text", () => {
    const node: WorkflowNode = {
      id: "node_missing",
      type: "custom.missing",
      position: { x: 80, y: 80 },
      config: {},
    };

    expect(buildCanvasNodeData({ node })).toEqual(
      expect.objectContaining({
        description: undefined,
        displayName: "node_missing",
        inputPorts: [],
        outputPorts: [],
        runSummary: null,
        runtimeStatus: undefined,
        runtimeStatusLabel: undefined,
        subtitle: "类型未加载",
        subtitleTitle: "custom.missing",
      })
    );
  });

  it("summarizes node issues for canvas badges", () => {
    const data = buildCanvasNodeData({
      issues: [
        workflowIssue({ id: "validation:url", source: "validation", severity: "error" }),
        workflowIssue({ id: "pre_run:method", source: "pre_run", severity: "warning" }),
      ],
      node: {
        id: "node_request",
        type: "http.request",
        position: { x: 80, y: 80 },
        config: {},
      },
      nodeType: httpRequestType,
    });

    expect(data.issues).toEqual({
      count: 2,
      errorCount: 1,
      firstIssue: workflowIssue({ id: "validation:url", source: "validation", severity: "error" }),
      label: "2 个问题",
      title: "此节点有 2 个问题：1 个错误，1 个警告",
      warningCount: 1,
    });
  });

  it("marks nodes with fixed debug output for the canvas", () => {
    const data = buildCanvasNodeData({
      node: {
        id: "node_request",
        type: "http.request",
        position: { x: 80, y: 80 },
        config: {},
        pinnedData: { success: { status: 200 } },
      },
      nodeType: httpRequestType,
    });

    expect(data.hasPinnedData).toBe(true);
  });

  it("marks disabled nodes for the canvas without treating them as runtime failures", () => {
    const data = buildCanvasNodeData({
      node: {
        id: "node_request",
        type: "http.request",
        position: { x: 80, y: 80 },
        config: {},
        disabled: true,
      },
      nodeType: httpRequestType,
    });

    expect(data.isDisabled).toBe(true);
  });

  it("shows configured dynamic output ports on the canvas", () => {
    const nodeType: NodeType = {
      ...httpRequestType,
      id: "logic.switch",
      outputs: { fallback: { displayName: "未匹配" } },
      dynamicOutputs: {
        configKey: "rules",
        idKey: "id",
        labelKey: "label",
        output: { description: "命中的输入" },
      },
    };
    const data = buildCanvasNodeData({
      node: {
        id: "switch",
        type: "logic.switch",
        position: { x: 80, y: 80 },
        config: { rules: [{ id: "matched", label: "命中目标" }] },
      },
      nodeType,
    });

    expect(data.outputPorts).toEqual([
      ["fallback", { displayName: "未匹配" }],
      ["matched", { description: "命中的输入", displayName: "命中目标" }],
    ]);
  });

  it("keeps node notes available for the canvas without changing the display name", () => {
    const data = buildCanvasNodeData({
      node: {
        id: "node_request",
        type: "http.request",
        position: { x: 80, y: 80 },
        config: {},
        notes: "登录前置接口，由测试环境触发。",
      },
      nodeType: httpRequestType,
    });

    expect(data.displayName).toBe("HTTP Request");
    expect(data.notes).toBe("登录前置接口，由测试环境触发。");
  });
});

const httpRequestType: NodeType = {
  id: "http.request",
  name: "HTTP Request",
  category: "action",
  description: "Send an HTTP request.",
  inputs: {
    input: {
      displayName: "输入",
    },
  },
  outputs: {
    success: {
      displayName: "成功",
    },
  },
  configSchema: { type: "object", properties: {} },
};

function nodeRunDetail(overrides: Partial<NodeRunDetail> = {}): NodeRunDetail {
  return {
    nodeId: "node_request",
    hasData: true,
    status: "succeeded",
    executionCount: 1,
    latestRunIndex: 0,
    latestScope: [],
    latestDurationMs: 8,
    inputItemCount: 0,
    outputItemCount: 2,
    latestInputItemCount: 0,
    latestOutputItemCount: 2,
    eventCount: 0,
    latestEventCount: 0,
    errorCount: 0,
    ...overrides,
  };
}

function workflowIssue(overrides: Partial<WorkflowIssueItem> = {}): WorkflowIssueItem {
  return {
    id: "validation:url",
    source: "validation",
    severity: "error",
    title: "节点配置问题",
    message: "URL 不能为空",
    location: "节点 node_request",
    target: {
      kind: "node",
      nodeId: "node_request",
      field: "url",
    },
    ...overrides,
  };
}
