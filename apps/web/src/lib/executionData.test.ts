import { describe, expect, it } from "vitest";
import type { RunEvent } from "../types";
import { buildExecutionData, latestNodeExecution } from "./executionData";

describe("buildExecutionData", () => {
  it("records disabled-node skips as a completed execution with passthrough outputs", () => {
    const data = buildExecutionData([
      runEvent({
        type: "node_skipped",
        node_id: "request",
        payload: { reason: "disabled", outputs: { success: { id: 7 } } },
      }),
    ]);

    expect(data.nodeRuns.request[0]).toMatchObject({
      status: "skipped",
      outputs: { success: { value: { id: 7 } } },
    });
  });

  it("groups node events into run-indexed executions with connection items", () => {
    const data = buildExecutionData([
      runEvent({
        id: 1,
        type: "node_started",
        node_id: "csv",
        payload: { inputs: { input: { source: "manual" } } },
      }),
      runEvent({
        id: 2,
        type: "node_succeeded",
        node_id: "csv",
        payload: {
          outputs: {
            success: {
              rows: [
                { name: "login", url: "/login" },
                { name: "profile", url: "/profile" },
              ],
            },
            error: null,
          },
          logs: [{ level: "info", message: "read csv" }],
          duration_ms: 12.5,
        },
      }),
      runEvent({
        id: 3,
        type: "node_started",
        node_id: "csv",
        scope: ["retry"],
        payload: { inputs: {} },
      }),
      runEvent({
        id: 4,
        type: "node_failed",
        node_id: "csv",
        scope: ["retry"],
        payload: { error: { message: "missing file" }, duration_ms: 2 },
      }),
    ]);

    expect(data.nodeOrder).toEqual(["csv"]);
    expect(data.nodeSummaries.csv).toEqual({
      nodeId: "csv",
      runCount: 2,
      latestStatus: "failed",
      outputConnectionCount: 2,
      inputItemCount: 2,
      outputItemCount: 2,
      errorCount: 1,
    });
    expect(data.nodeRuns.csv).toHaveLength(2);
    expect(data.nodeRuns.csv[0]).toMatchObject({
      nodeId: "csv",
      runIndex: 0,
      status: "succeeded",
      durationMs: 12.5,
      inputs: { input: { source: "manual" } },
      inputItems: [{ json: { input: { source: "manual" } } }],
      logs: [{ level: "info", message: "read csv" }],
      scope: [],
    });
    expect(data.nodeRuns.csv[0].outputs.success.value).toEqual({
      rows: [
        { name: "login", url: "/login" },
        { name: "profile", url: "/profile" },
      ],
    });
    expect(data.nodeRuns.csv[0].outputs.success.items).toEqual([
      { json: { rows: [{ name: "login", url: "/login" }, { name: "profile", url: "/profile" }] } },
    ]);
    expect(data.nodeRuns.csv[1]).toMatchObject({
      nodeId: "csv",
      runIndex: 1,
      status: "failed",
      scope: ["retry"],
      error: { message: "missing file" },
      durationMs: 2,
      inputItems: [{ json: {} }],
    });
  });

  it("normalizes array outputs as item data and returns the latest node execution", () => {
    const data = buildExecutionData([
      runEvent({
        type: "node_succeeded",
        node_id: "transform",
        payload: {
          outputs: {
            success: [{ id: 1 }, { id: 2 }],
          },
        },
      }),
      runEvent({
        type: "node_succeeded",
        node_id: "transform",
        scope: ["each", "iteration:0"],
        payload: {
          outputs: {
            success: { id: 3 },
          },
        },
      }),
    ]);

    expect(data.nodeRuns.transform[0].outputs.success.items).toEqual([{ json: { id: 1 } }, { json: { id: 2 } }]);
    expect(data.nodeSummaries.transform).toEqual({
      nodeId: "transform",
      runCount: 2,
      latestStatus: "succeeded",
      outputConnectionCount: 2,
      inputItemCount: 0,
      outputItemCount: 3,
      errorCount: 0,
    });
    expect(latestNodeExecution(data, "transform")).toMatchObject({
      runIndex: 1,
      scope: ["each", "iteration:0"],
      outputs: {
        success: {
          value: { id: 3 },
          items: [{ json: { id: 3 } }],
        },
      },
    });
  });

  it("prefers authoritative port item data from new execution events", () => {
    const inputItem = { json: { id: 1 }, pairedItem: { item: 0 } };
    const outputItem = { json: { id: 2 }, binary: { attachment: { mimeType: "text/plain" } } };
    const data = buildExecutionData([
      runEvent({
        type: "node_started",
        node_id: "request",
        payload: {
          inputs: { body: { legacy: true } },
          input_items: { body: [inputItem] },
        },
      }),
      runEvent({
        type: "node_succeeded",
        node_id: "request",
        payload: {
          outputs: { success: { legacy: true } },
          output_items: { success: [outputItem] },
        },
      }),
    ]);

    expect(data.nodeRuns.request[0].inputItems).toEqual([inputItem]);
    expect(data.nodeRuns.request[0].outputs.success.items).toEqual([outputItem]);
  });
});

function runEvent(overrides: Partial<RunEvent>): RunEvent {
  return {
    run_id: "run_1",
    type: "node_started",
    timestamp: "2026-06-23T00:00:00Z",
    node_id: null,
    scope: [],
    payload: {},
    ...overrides,
  };
}
