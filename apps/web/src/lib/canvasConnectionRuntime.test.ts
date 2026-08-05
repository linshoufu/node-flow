import { describe, expect, it } from "vitest";
import type { NodeRunDetail } from "./nodeRunDetail";
import { buildCanvasConnectionRuntime } from "./canvasConnectionRuntime";

describe("canvas connection runtime", () => {
  it("builds edge runtime data from the source node output handle", () => {
    expect(
      buildCanvasConnectionRuntime(
        {
          id: "edge_manual_log",
          source: "node_manual",
          sourceHandle: "output",
          target: "node_log",
          targetHandle: "input",
        },
        {
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
        }
      )
    ).toEqual({
      className: "has-run-data run-succeeded",
      data: {
        itemCount: 2,
        status: "succeeded",
      },
      label: "2 项数据",
    });
  });

  it("omits edge runtime data when the source output has no items", () => {
    expect(
      buildCanvasConnectionRuntime(
        {
          id: "edge_manual_log",
          source: "node_manual",
          sourceHandle: "output",
          target: "node_log",
          targetHandle: "input",
        },
        {
          node_manual: nodeRunDetail(),
        }
      )
    ).toBeNull();
  });
});

function nodeRunDetail(overrides: Partial<NodeRunDetail> = {}): NodeRunDetail {
  return {
    nodeId: "node_manual",
    hasData: true,
    status: "succeeded",
    executionCount: 1,
    latestRunIndex: 0,
    latestScope: [],
    inputItemCount: 0,
    outputItemCount: 0,
    latestInputItemCount: 0,
    latestOutputItemCount: 0,
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
