import { describe, expect, it } from "vitest";
import type { RunEvent } from "../types";
import { buildExecutionData } from "./executionData";
import { buildExecutionDataView, filterExecutionNodeIds } from "./executionDataView";

describe("execution data view helpers", () => {
  it("filters execution nodes by display name, status, ports, and payload text", () => {
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
        payload: { outputs: { success: { status_code: 200, body: "token" } } },
      }),
      runEvent({
        id: 3,
        type: "node_started",
        node_id: "assert",
        payload: { inputs: { actual: 500 } },
      }),
      runEvent({
        id: 4,
        type: "node_failed",
        node_id: "assert",
        payload: { error: { message: "status mismatch" } },
      }),
    ]);

    expect(filterExecutionNodeIds(data, { query: "login", status: "all" }, { request: "\u767b\u5f55\u8bf7\u6c42" })).toEqual([
      "request",
    ]);
    expect(filterExecutionNodeIds(data, { query: "\u767b\u5f55", status: "all" }, { request: "\u767b\u5f55\u8bf7\u6c42" })).toEqual([
      "request",
    ]);
    expect(filterExecutionNodeIds(data, { query: "success", status: "all" }, {})).toEqual(["request"]);
    expect(filterExecutionNodeIds(data, { query: "", status: "failed" }, {})).toEqual(["assert"]);
  });

  it("builds a status-counted execution data view model", () => {
    const data = buildExecutionData([
      runEvent({ id: 1, type: "node_started", node_id: "request", payload: { inputs: { url: "/login" } } }),
      runEvent({ id: 2, type: "node_succeeded", node_id: "request", payload: { outputs: { success: { ok: true } } } }),
      runEvent({ id: 3, type: "node_failed", node_id: "assert", payload: { error: "status mismatch" } }),
      runEvent({ id: 4, type: "node_started", node_id: "delay", payload: { inputs: { ms: 1000 } } }),
    ]);

    expect(buildExecutionDataView(data, { query: "", status: "all" }, {}).statusCounts).toEqual({
      all: 3,
      cancelled: 0,
      failed: 1,
      handled: 0,
      pending: 0,
      running: 1,
      skipped: 0,
      succeeded: 1,
    });
    expect(buildExecutionDataView(data, { query: "", status: "running" }, {}).nodeIds).toEqual(["delay"]);
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
