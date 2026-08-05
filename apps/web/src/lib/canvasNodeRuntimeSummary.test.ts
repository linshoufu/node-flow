import { describe, expect, it } from "vitest";
import type { NodeRunDetail } from "./nodeRunDetail";
import type { NodeRuntimeState } from "./runState";
import { buildCanvasNodeRuntimeSummary } from "./canvasNodeRuntimeSummary";

describe("canvas node runtime summary", () => {
  it("builds product-facing canvas badges from unified run details", () => {
    const summary = buildCanvasNodeRuntimeSummary({
      runDetail: nodeRunDetail({
        executionCount: 3,
        inputItemCount: 5,
        outputItemCount: 7,
        errorCount: 1,
        latestDurationMs: 1280,
      }),
      runtimeState: runtimeState({
        scopes: [
          ["each", "iteration:0"],
          ["each", "iteration:1"],
          ["each", "iteration:2"],
        ],
      }),
    });

    expect(summary?.badges.map((badge) => badge.label)).toEqual([
      "3 次执行",
      "3 轮循环",
      "5 项输入",
      "7 项输出",
      "1 个错误",
      "耗时 1.3 秒",
    ]);
    expect(summary?.ariaLabel).toBe("3 次执行，3 轮循环，5 项输入，7 项输出，1 个错误，耗时 1.3 秒");
  });

  it("falls back to runtime state when persisted run details are unavailable", () => {
    const summary = buildCanvasNodeRuntimeSummary({
      runtimeState: runtimeState({
        executions: [
          {
            runIndex: 0,
            status: "succeeded",
            scope: [],
            inputItems: [{ json: { id: 1 } }],
            outputs: {
              success: {
                name: "success",
                value: [{ ok: true }, { ok: false }],
                items: [{ json: { ok: true } }, { json: { ok: false } }],
              },
            },
            events: [],
          },
          {
            runIndex: 1,
            status: "failed",
            scope: ["each", "iteration:0"],
            inputs: { row: 2 },
            outputs: {},
            error: { message: "boom" },
            durationMs: 18,
            events: [],
          },
        ],
      }),
    });

    expect(summary?.badges.map((badge) => badge.label)).toEqual([
      "2 次执行",
      "1 轮循环",
      "2 项输入",
      "2 项输出",
      "1 个错误",
      "耗时 18 ms",
    ]);
  });

  it("omits runtime summary for pending nodes without data", () => {
    expect(buildCanvasNodeRuntimeSummary({ runtimeState: runtimeState({ status: "pending" }) })).toBeNull();
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
    ...overrides,
  };
}

function runtimeState(overrides: Partial<NodeRuntimeState> = {}): NodeRuntimeState {
  return {
    nodeId: "node_manual",
    status: "succeeded",
    scopes: [],
    executions: [],
    ...overrides,
  };
}
