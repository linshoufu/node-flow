import { describe, expect, it } from "vitest";
import type { RunEvent } from "../types";
import { buildTestReport } from "./testReport";

describe("buildTestReport", () => {
  it("returns an empty report for empty events", () => {
    expect(buildTestReport([])).toEqual({
      summary: { total: 0, passed: 0, failed: 0, unknown: 0 },
      cases: [],
      hasCases: false,
    });
  });

  it("extracts a passed case from a record_result success output", () => {
    const report = buildTestReport([
      runEvent({
        type: "node_succeeded",
        node_id: "record-login",
        payload: {
          node_type: "test.record_result",
          outputs: {
            success: {
              result: {
                id: "case-login",
                name: "logs in",
                status: "passed",
                message: "ok",
                duration_ms: 12,
              },
            },
          },
        },
      }),
    ]);

    expect(report).toEqual({
      summary: { total: 1, passed: 1, failed: 0, unknown: 0 },
      cases: [
        {
          id: "case-login",
          name: "logs in",
          status: "passed",
          message: "ok",
          durationMs: 12,
          sourceNodeId: "record-login",
        },
      ],
      hasCases: true,
    });
  });

  it("extracts multiple mixed cases and calculates the summary from cases", () => {
    const report = buildTestReport([
      recordResultEvent("record-1", { name: "first", status: "passed" }),
      recordResultEvent("record-2", { name: "second", status: "failed", message: "Expected 2" }),
      recordResultEvent("record-3", { name: "third" }),
    ]);

    expect(report.summary).toEqual({ total: 3, passed: 1, failed: 1, unknown: 1 });
    expect(report.cases.map((testCase) => testCase.status)).toEqual(["passed", "failed", "unknown"]);
  });

  it("does not let zero summary totals override extracted cases", () => {
    const report = buildTestReport([
      recordResultEvent("record-1", { name: "first", status: "passed" }),
      runEvent({
        type: "node_succeeded",
        node_id: "summary",
        payload: {
          node_type: "test.summary",
          outputs: {
            success: {
              summary: { total: 0, passed: 0, failed: 0, unknown: 0 },
            },
          },
        },
      }),
    ]);

    expect(report.summary).toEqual({ total: 1, passed: 1, failed: 0, unknown: 0 });
  });

  it("uses summary totals when there are no case events", () => {
    const report = buildTestReport([
      runEvent({
        type: "node_succeeded",
        node_id: "summary",
        payload: {
          node_type: "test.summary",
          outputs: {
            summary: { total: 5, passed: 3, failed: 1, unknown: 1 },
          },
        },
      }),
    ]);

    expect(report).toEqual({
      summary: { total: 5, passed: 3, failed: 1, unknown: 1 },
      cases: [],
      hasCases: false,
    });
  });

  it("infers status from a boolean passed field", () => {
    const report = buildTestReport([
      recordResultEvent("record-pass", { name: "boolean pass", passed: true }),
      recordResultEvent("record-fail", { name: "boolean fail", passed: false }),
    ]);

    expect(report.cases.map((testCase) => testCase.status)).toEqual(["passed", "failed"]);
    expect(report.summary).toEqual({ total: 2, passed: 1, failed: 1, unknown: 0 });
  });

  it("extracts a real record_result event without node_type when success is the result object", () => {
    const report = buildTestReport([
      runEvent({
        type: "node_succeeded",
        node_id: "record_result",
        payload: {
          outputs: {
            success: {
              name: "real shape",
              status: "failed",
              message: "Mismatch",
              duration_ms: 14,
            },
          },
          duration_ms: 15,
        },
      }),
      runEvent({
        type: "node_succeeded",
        node_id: "record-1",
        payload: {
          outputs: {
            success: {
              name: "hyphen record",
              passed: true,
            },
          },
        },
      }),
    ]);

    expect(report.summary).toEqual({ total: 2, passed: 1, failed: 1, unknown: 0 });
    expect(report.cases).toEqual([
      {
        id: "record_result",
        name: "real shape",
        status: "failed",
        message: "Mismatch",
        durationMs: 14,
        sourceNodeId: "record_result",
      },
      {
        id: "record-1",
        name: "hyphen record",
        status: "passed",
        sourceNodeId: "record-1",
      },
    ]);
  });

  it("uses summary totals without node_type when summary output exists", () => {
    const report = buildTestReport([
      runEvent({
        type: "node_succeeded",
        node_id: "summary",
        payload: {
          outputs: {
            success: {
              summary: { total: 4, passed: 2, failed: 1, unknown: 1 },
            },
          },
        },
      }),
    ]);

    expect(report).toEqual({
      summary: { total: 4, passed: 2, failed: 1, unknown: 1 },
      cases: [],
      hasCases: false,
    });
  });

  it("uses failed summary totals when there are no case events", () => {
    const report = buildTestReport([
      runEvent({
        type: "node_succeeded",
        node_id: "summary",
        payload: {
          node_type: "test.summary",
          outputs: {
            failed: {
              summary: { total: 3, passed: 1, failed: 2, unknown: 0 },
            },
          },
        },
      }),
    ]);

    expect(report).toEqual({
      summary: { total: 3, passed: 1, failed: 2, unknown: 0 },
      cases: [],
      hasCases: false,
    });
  });

  it("does not treat ordinary node outputs as test cases", () => {
    const report = buildTestReport([
      runEvent({
        type: "node_succeeded",
        node_id: "request",
        payload: {
          outputs: {
            success: {
              response: { ok: true },
              status_code: 200,
              url: "https://example.test",
            },
          },
        },
      }),
    ]);

    expect(report).toEqual({
      summary: { total: 0, passed: 0, failed: 0, unknown: 0 },
      cases: [],
      hasCases: false,
    });
  });

  it("does not treat CSV outputs as test cases", () => {
    const report = buildTestReport([
      runEvent({
        type: "node_succeeded",
        node_id: "read_csv",
        payload: {
          outputs: {
            success: {
              headers: ["name", "status"],
              columns: ["name", "status"],
              rows: [
                { name: "Alice", status: "active" },
                { name: "Bob", status: "inactive" },
              ],
            },
          },
        },
      }),
    ]);

    expect(report).toEqual({
      summary: { total: 0, passed: 0, failed: 0, unknown: 0 },
      cases: [],
      hasCases: false,
    });
  });

  it("does not treat ordinary node summary outputs as test summary", () => {
    const report = buildTestReport([
      runEvent({
        type: "node_succeeded",
        node_id: "request",
        payload: {
          outputs: {
            success: {
              summary: { total: 10, passed: 9, failed: 1, unknown: 0 },
            },
          },
        },
      }),
    ]);

    expect(report).toEqual({
      summary: { total: 0, passed: 0, failed: 0, unknown: 0 },
      cases: [],
      hasCases: false,
    });
  });

  it("does not mutate input events", () => {
    const events = [
      recordResultEvent("record-1", {
        name: "immutable",
        status: "passed",
        durationMs: 8,
      }),
    ];
    const before = structuredClone(events);

    buildTestReport(events);

    expect(events).toEqual(before);
  });
});

function recordResultEvent(nodeId: string, result: Record<string, unknown>): RunEvent {
  return runEvent({
    type: "node_succeeded",
    node_id: nodeId,
    payload: {
      node_type: "test.record_result",
      outputs: {
        success: { case: result },
      },
    },
  });
}

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
