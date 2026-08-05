import { describe, expect, it } from "vitest";
import { buildExecutionData } from "./executionData";
import { buildNodeRunDetail } from "./nodeRunDetail";
import type { RunEvent } from "../types";

describe("buildNodeRunDetail", () => {
  it("builds a focused detail model for the selected node latest execution", () => {
    const data = buildExecutionData([
      runEvent({
        id: 1,
        type: "node_started",
        node_id: "request",
        payload: { inputs: { url: "/login" } },
      }),
      runEvent({
        id: 2,
        type: "node_succeeded",
        node_id: "request",
        payload: { duration_ms: 18, outputs: { success: [{ status_code: 200 }, { status_code: 201 }] } },
      }),
      runEvent({
        id: 3,
        type: "node_started",
        node_id: "request",
        scope: ["each", "iteration:1"],
        payload: { inputs: { url: "/profile" } },
      }),
      runEvent({
        id: 4,
        type: "node_failed",
        node_id: "request",
        scope: ["each", "iteration:1"],
        payload: { duration_ms: 5, error: { message: "boom" } },
      }),
    ]);

    expect(buildNodeRunDetail(data, "request")).toMatchObject({
      nodeId: "request",
      hasData: true,
      status: "failed",
      executionCount: 2,
      latestRunIndex: 1,
      latestScope: ["each", "iteration:1"],
      latestDurationMs: 5,
      inputItemCount: 2,
      outputItemCount: 2,
      latestInputItemCount: 1,
      latestOutputItemCount: 0,
      eventCount: 4,
      latestEventCount: 2,
      errorCount: 1,
    });
  });

  it("returns an empty detail model for an unexecuted selected node", () => {
    const data = buildExecutionData([]);

    expect(buildNodeRunDetail(data, "manual")).toEqual({
      nodeId: "manual",
      hasData: false,
      status: "pending",
      executionCount: 0,
      latestRunIndex: null,
      latestScope: [],
      latestDurationMs: undefined,
      inputItemCount: 0,
      outputItemCount: 0,
      latestInputItemCount: 0,
      latestOutputItemCount: 0,
      eventCount: 0,
      latestEventCount: 0,
      errorCount: 0,
      latestExecution: undefined,
      summary: undefined,
    });
  });
});

function runEvent(overrides: Partial<RunEvent>): RunEvent {
  return {
    run_id: "run_1",
    type: "node_started",
    timestamp: "2026-06-18T00:00:00Z",
    node_id: null,
    scope: [],
    payload: {},
    ...overrides,
  };
}
