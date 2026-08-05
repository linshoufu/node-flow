import { describe, expect, it } from "vitest";
import type { RunRecord } from "../types";
import {
  canCancelRunView,
  currentRunView,
  emptyRunView,
  historicalRunView,
  runViewExecutionSummary,
  isHistoricalRunView,
  isTerminalRunStatus,
  runViewWithCurrentRun,
  runViewWithEvents,
} from "./runView";

describe("run view helpers", () => {
  it("models an empty run view", () => {
    const view = emptyRunView();

    expect(view.mode).toBe("empty");
    expect(view.run).toBeNull();
    expect(view.events).toEqual([]);
    expect(isHistoricalRunView(view)).toBe(false);
    expect(canCancelRunView(view)).toBe(false);
  });

  it("allows cancelling queued or running current runs only", () => {
    expect(canCancelRunView(currentRunView(runRecord({ status: "queued" }), []))).toBe(true);
    expect(canCancelRunView(currentRunView(runRecord({ status: "running" }), []))).toBe(true);
    expect(canCancelRunView(currentRunView(runRecord({ status: "succeeded" }), []))).toBe(false);
    expect(canCancelRunView(currentRunView(runRecord({ status: "failed" }), []))).toBe(false);
    expect(canCancelRunView(currentRunView(runRecord({ status: "cancelled" }), []))).toBe(false);
  });

  it("keeps historical runs inspectable but not cancellable", () => {
    const view = historicalRunView(runRecord({ id: "run_history", status: "running" }), []);

    expect(view.mode).toBe("history");
    expect(view.run?.id).toBe("run_history");
    expect(isHistoricalRunView(view)).toBe(true);
    expect(canCancelRunView(view)).toBe(false);
  });

  it("identifies terminal run statuses", () => {
    expect(isTerminalRunStatus("queued")).toBe(false);
    expect(isTerminalRunStatus("running")).toBe(false);
    expect(isTerminalRunStatus("succeeded")).toBe(true);
    expect(isTerminalRunStatus("failed")).toBe(true);
    expect(isTerminalRunStatus("cancelled")).toBe(true);
  });
  it("summarizes execution coverage for a run view", () => {
    const run = runRecord({ id: "run_summary" });
    const view = currentRunView(run, [
      runEvent({ id: 1, run_id: run.id, type: "node_started", node_id: "request", payload: { inputs: [{ id: 1 }, { id: 2 }] } }),
      runEvent({ id: 2, run_id: run.id, type: "node_succeeded", node_id: "request", payload: { outputs: { success: [{ ok: true }, { ok: false }] } } }),
      runEvent({ id: 3, run_id: run.id, type: "node_started", node_id: "request", scope: ["each", "iteration:1"], payload: { inputs: { id: 3 } } }),
      runEvent({ id: 4, run_id: run.id, type: "node_failed", node_id: "request", scope: ["each", "iteration:1"], payload: { error: "boom" } }),
      runEvent({ id: 5, run_id: run.id, type: "run_succeeded", node_id: null }),
    ]);

    expect(runViewExecutionSummary(view)).toEqual({
      nodeCount: 1,
      executionCount: 2,
      eventCount: 5,
      failedExecutionCount: 1,
      inputItemCount: 3,
      outputItemCount: 2,
    });
  });
  it("replaces events while preserving the current run view mode", () => {
    const run = runRecord({ id: "run_current", status: "running" });
    const event = runEvent({ run_id: run.id, type: "node_started" });
    const view = runViewWithEvents(currentRunView(run, []), [event]);

    expect(view.mode).toBe("current");
    expect(view.run).toBe(run);
    expect(view.events).toEqual([event]);
  });

  it("replaces events while preserving the historical run view mode", () => {
    const run = runRecord({ id: "run_history" });
    const event = runEvent({ run_id: run.id, type: "node_succeeded" });
    const view = runViewWithEvents(historicalRunView(run, []), [event]);

    expect(view.mode).toBe("history");
    expect(view.run).toBe(run);
    expect(view.events).toEqual([event]);
  });

  it("switches any view to the current run while keeping loaded events", () => {
    const event = runEvent({ run_id: "run_old", type: "node_started" });
    const view = runViewWithCurrentRun(historicalRunView(runRecord({ id: "run_old" }), [event]), runRecord({ id: "run_new" }));

    expect(view.mode).toBe("current");
    expect(view.run?.id).toBe("run_new");
    expect(view.events).toEqual([event]);
  });
});

function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run_1",
    workflow_id: "wf_1",
    workflow_version: 1,
    status: "succeeded",
    created_at: "2026-06-24T02:00:00Z",
    started_at: "2026-06-24T02:00:01Z",
    completed_at: "2026-06-24T02:00:02Z",
    error: null,
    ...overrides,
  };
}

function runEvent(overrides: { id?: number; run_id?: string; type?: string; node_id?: string | null; scope?: string[]; payload?: Record<string, unknown> } = {}) {
  return {
    run_id: "run_1",
    type: "node_started",
    timestamp: "2026-06-24T02:00:01Z",
    node_id: null,
    scope: [],
    payload: {},
    ...overrides,
  };
}