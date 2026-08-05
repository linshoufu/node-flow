import { describe, expect, it } from "vitest";
import type { NodeRunDetail } from "./nodeRunDetail";
import { buildCanvasConnectionEdge } from "./canvasConnectionEdge";
import type { NodeType, WorkflowDocument } from "../types";

describe("canvas connection edge", () => {
  it("maps workflow connections to canvas edges with port metadata and runtime data", () => {
    const edge = buildCanvasConnectionEdge({
      edge: workflow.edges[0],
      nodeRunDetails: {
        node_manual: nodeRunDetail({
          latestExecution: {
            nodeId: "node_manual",
            runIndex: 0,
            status: "succeeded",
            scope: [],
            outputs: {
              output: {
                name: "output",
                value: [{ ok: true }, { ok: false }],
                items: [{ json: { ok: true } }, { json: { ok: false } }],
              },
            },
            events: [],
          },
        }),
      },
      nodeTypes,
      selected: true,
      workflow,
    });

    expect(edge).toEqual(
      expect.objectContaining({
        id: "edge_manual_log",
        source: "node_manual",
        sourceHandle: "output",
        target: "node_log",
        targetHandle: "input",
        selected: true,
        className: "has-run-data run-succeeded",
        label: "成功输出 → 日志输入 · 2 项数据",
        data: {
          itemCount: 2,
          source: {
            displayName: "成功输出",
            handle: "output",
            nodeId: "node_manual",
          },
          status: "succeeded",
          target: {
            displayName: "日志输入",
            handle: "input",
            nodeId: "node_log",
          },
        },
      })
    );
  });

  it("shows source and target port names when a connection is selected without runtime data", () => {
    const edge = buildCanvasConnectionEdge({
      edge: workflow.edges[0],
      nodeRunDetails: {},
      nodeTypes,
      selected: true,
      workflow,
    });

    expect(edge).toEqual(
      expect.objectContaining({
        label: "成功输出 → 日志输入",
        selected: true,
      })
    );
  });

  it("keeps unselected connections quiet before runtime data exists", () => {
    const edge = buildCanvasConnectionEdge({
      edge: workflow.edges[0],
      nodeRunDetails: {},
      nodeTypes,
      selected: false,
      workflow,
    });

    expect(edge.label).toBeUndefined();
  });
});

const nodeTypes: NodeType[] = [
  {
    id: "manual.trigger",
    name: "Manual Trigger",
    category: "trigger",
    description: "Start a workflow manually.",
    inputs: {},
    outputs: {
      output: {
        displayName: "成功输出",
      },
    },
    configSchema: { type: "object", properties: {} },
  },
  {
    id: "utility.log",
    name: "Log",
    category: "utility",
    description: "Write a log line.",
    inputs: {
      input: {
        displayName: "日志输入",
      },
    },
    outputs: {},
    configSchema: { type: "object", properties: {} },
  },
];

const workflow: WorkflowDocument = {
  id: "wf_canvas_connection",
  name: "Canvas Connection",
  version: 1,
  nodes: [
    {
      id: "node_manual",
      type: "manual.trigger",
      position: { x: 80, y: 80 },
      config: {},
    },
    {
      id: "node_log",
      type: "utility.log",
      position: { x: 320, y: 80 },
      config: {},
    },
  ],
  edges: [
    {
      id: "edge_manual_log",
      source: "node_manual",
      sourceHandle: "output",
      target: "node_log",
      targetHandle: "input",
    },
  ],
};

function nodeRunDetail(overrides: Partial<NodeRunDetail> = {}): NodeRunDetail {
  return {
    nodeId: "node_manual",
    hasData: true,
    status: "succeeded",
    executionCount: 1,
    latestRunIndex: 0,
    latestScope: [],
    inputItemCount: 0,
    outputItemCount: 2,
    latestInputItemCount: 0,
    latestOutputItemCount: 2,
    eventCount: 0,
    latestEventCount: 0,
    errorCount: 0,
    latestExecution: {
      nodeId: "node_manual",
      runIndex: 0,
      status: "succeeded",
      scope: [],
      outputs: {},
      events: [],
    },
    ...overrides,
  };
}
