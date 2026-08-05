import { describe, expect, it } from "vitest";
import type { RunEvent, RunRecord } from "../types";
import { buildRunInspector } from "./runInspector";

describe("buildRunInspector", () => {
  it("builds a current run inspector from events and selected node state", () => {
    const inspector = buildRunInspector({
      run: runRecord({ status: "succeeded" }),
      events: [
        runEvent({
          id: 1,
          type: "node_started",
          node_id: "csv",
          payload: { inputs: { path: "cases.csv" } },
        }),
        runEvent({
          id: 2,
          type: "node_succeeded",
          node_id: "csv",
          payload: {
            outputs: { success: [{ case: "login" }, { case: "logout" }] },
            duration_ms: 15,
          },
        }),
      ],
      selectedNodeId: "csv",
    });

    expect(inspector.view.mode).toBe("current");
    expect(inspector.executionData.nodeOrder).toEqual(["csv"]);
    expect(inspector.executionSummary).toEqual({
      nodeCount: 1,
      executionCount: 1,
      eventCount: 2,
      failedExecutionCount: 0,
      inputItemCount: 1,
      outputItemCount: 2,
    });
    expect(inspector.report.hasCases).toBe(false);
    expect(inspector.selectedNodeRunDetail).toMatchObject({
      nodeId: "csv",
      hasData: true,
      status: "succeeded",
      executionCount: 1,
      latestOutputItemCount: 2,
      eventCount: 2,
    });
  });

  it("keeps history mode and omits selected node detail when no node is selected", () => {
    const inspector = buildRunInspector({
      run: runRecord({ id: "historical_run", status: "failed" }),
      events: [runEvent({ type: "node_failed", node_id: "request", payload: { error: "boom" } })],
      isHistoricalRun: true,
      selectedNodeId: null,
    });

    expect(inspector.view.mode).toBe("history");
    expect(inspector.view.run?.id).toBe("historical_run");
    expect(inspector.executionSummary?.failedExecutionCount).toBe(1);
    expect(inspector.selectedNodeRunDetail).toBeNull();
  });

  it("builds canvas runtime artifacts for editable nodes", () => {
    const inspector = buildRunInspector({
      run: runRecord({ status: "succeeded" }),
      events: [
        runEvent({
          id: 1,
          type: "node_succeeded",
          node_id: "csv",
          payload: {
            outputs: { success: [{ case: "login" }, { case: "logout" }] },
            duration_ms: 9,
          },
        }),
      ],
      nodeIds: ["csv", "assert"],
      selectedNodeId: "assert",
    });

    expect(inspector.nodeRunStates.csv).toMatchObject({
      nodeId: "csv",
      status: "succeeded",
      durationMs: 9,
    });
    expect(inspector.nodeRunStates.assert).toMatchObject({
      nodeId: "assert",
      status: "pending",
    });
    expect(inspector.nodeRunDetails.csv).toMatchObject({
      nodeId: "csv",
      hasData: true,
      latestOutputItemCount: 2,
    });
    expect(inspector.nodeRunDetails.assert).toMatchObject({
      nodeId: "assert",
      hasData: false,
      status: "pending",
    });
    expect(inspector.selectedRuntimeState).toMatchObject({
      nodeId: "assert",
      status: "pending",
    });
  });

  it("groups run data, canvas data, and selection data into view model sections", () => {
    const inspector = buildRunInspector({
      run: runRecord({ status: "succeeded" }),
      events: [
        runEvent({
          id: 1,
          type: "node_succeeded",
          node_id: "csv",
          payload: { outputs: { success: [{ case: "login" }] } },
        }),
      ],
      nodeIds: ["csv"],
      selectedNodeId: "csv",
    });

    expect(inspector.runData).toMatchObject({
      executionData: inspector.executionData,
      report: inspector.report,
      executionSummary: inspector.executionSummary,
    });
    expect(inspector.canvas).toMatchObject({
      nodeRunStates: inspector.nodeRunStates,
      nodeRunDetails: inspector.nodeRunDetails,
    });
    expect(inspector.selection).toMatchObject({
      nodeId: "csv",
      runtimeState: inspector.selectedRuntimeState,
      runDetail: inspector.selectedNodeRunDetail,
    });
  });

  it("returns an empty run view with reusable empty execution artifacts when no run exists", () => {
    const inspector = buildRunInspector({
      run: null,
      events: [],
      selectedNodeId: "manual",
    });

    expect(inspector.view.mode).toBe("empty");
    expect(inspector.executionData.nodeOrder).toEqual([]);
    expect(inspector.executionSummary).toBeNull();
    expect(inspector.report).toEqual({
      summary: { total: 0, passed: 0, failed: 0, unknown: 0 },
      cases: [],
      hasCases: false,
    });
    expect(inspector.selectedNodeRunDetail).toMatchObject({
      nodeId: "manual",
      hasData: false,
      status: "pending",
    });
    expect(inspector.nodeRunStates).toEqual({});
    expect(inspector.nodeRunDetails).toEqual({});
    expect(inspector.selectedRuntimeState).toBeUndefined();
  });
});

function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run_1",
    workflow_id: "wf_1",
    workflow_version: 1,
    status: "running",
    created_at: "2026-06-25T00:00:00Z",
    started_at: "2026-06-25T00:00:01Z",
    completed_at: null,
    error: null,
    ...overrides,
  };
}

function runEvent(overrides: Partial<RunEvent>): RunEvent {
  return {
    run_id: "run_1",
    type: "node_started",
    timestamp: "2026-06-25T00:00:00Z",
    node_id: null,
    scope: [],
    payload: {},
    ...overrides,
  };
}
