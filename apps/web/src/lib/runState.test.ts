import { describe, expect, it } from "vitest";
import type { RunEvent, WorkflowNode } from "../types";
import { buildNodeRunStates } from "./runState";

const workflowNodes: WorkflowNode[] = [
  {
    id: "start",
    type: "manual.trigger",
    position: { x: 0, y: 0 },
    config: {},
  },
  {
    id: "request",
    type: "http.request",
    position: { x: 200, y: 0 },
    config: {},
  },
  {
    id: "never_run",
    type: "utility.log",
    position: { x: 400, y: 0 },
    config: {},
  },
];

describe("buildNodeRunStates", () => {
  it("aggregates run events into per-node debug state", () => {
    const events: RunEvent[] = [
      runEvent({
        id: 1,
        type: "node_started",
        node_id: "start",
        payload: { inputs: {} },
      }),
      runEvent({
        id: 2,
        type: "node_succeeded",
        node_id: "start",
        payload: {
          outputs: { success: { rows: [1, 2] } },
          duration_ms: 2.5,
        },
      }),
      runEvent({
        id: 3,
        type: "node_started",
        node_id: "request",
        scope: ["each", "iteration:0"],
        payload: { inputs: { body: { name: "Alice" } } },
      }),
      runEvent({
        id: 4,
        type: "node_failed",
        node_id: "request",
        scope: ["each", "iteration:0"],
        payload: {
          error: { message: "HTTP 500" },
          logs: [{ level: "error", message: "failed" }],
          duration_ms: 9,
        },
      }),
    ];

    const states = buildNodeRunStates(workflowNodes, events);

    expect(states.start).toMatchObject({
      nodeId: "start",
      status: "succeeded",
      inputs: {},
      outputs: { success: { rows: [1, 2] } },
      durationMs: 2.5,
    });
    expect(states.start.scopes).toEqual([[]]);
    expect(states.request).toMatchObject({
      nodeId: "request",
      status: "failed",
      inputs: { body: { name: "Alice" } },
      error: { message: "HTTP 500" },
      logs: [{ level: "error", message: "failed" }],
      durationMs: 9,
    });
    expect(states.request.scopes).toEqual([["each", "iteration:0"]]);
    expect(states.never_run.status).toBe("pending");
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
