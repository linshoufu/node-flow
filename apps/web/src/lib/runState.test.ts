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
        payload: {
          inputs: { body: { name: "Alice" } },
          item_context: { index: 0, item: { json: { name: "Alice" }, pairedItem: { item: 4 } } },
        },
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
    expect(states.start.events).toMatchObject([
      { type: "node_started", inputs: {} },
      { type: "node_succeeded", outputs: { success: { rows: [1, 2] } }, durationMs: 2.5 },
    ]);
    expect(states.request).toMatchObject({
      nodeId: "request",
      status: "failed",
      inputs: { body: { name: "Alice" } },
      error: { message: "HTTP 500" },
      logs: [{ level: "error", message: "failed" }],
      durationMs: 9,
      itemContext: { index: 0, item: { json: { name: "Alice" }, pairedItem: { item: 4 } } },
    });
    expect(states.request.scopes).toEqual([["each", "iteration:0"]]);
    expect(states.request.events).toMatchObject([
      { type: "node_started", scope: ["each", "iteration:0"], inputs: { body: { name: "Alice" } } },
      { type: "node_failed", scope: ["each", "iteration:0"], error: { message: "HTTP 500" }, durationMs: 9 },
    ]);
    expect(states.never_run.status).toBe("pending");
  });

  it("marks unfinished nodes when a run is cancelled", () => {
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
        payload: { outputs: { success: {} } },
      }),
      runEvent({
        id: 3,
        type: "node_started",
        node_id: "request",
        payload: { inputs: {} },
      }),
    ];

    const states = buildNodeRunStates(workflowNodes, events, "cancelled");

    expect(states.start.status).toBe("succeeded");
    expect(states.request.status).toBe("cancelled");
    expect(states.never_run.status).toBe("skipped");
  });

  it("marks a failed node as handled when its failure policy continues", () => {
    const events: RunEvent[] = [
      runEvent({
        id: 1,
        type: "node_started",
        node_id: "request",
        payload: { inputs: { url: "https://example.test" } },
      }),
      runEvent({
        id: 2,
        type: "node_failed",
        node_id: "request",
        payload: { error: { message: "HTTP 500" } },
      }),
      runEvent({
        id: 3,
        type: "node_error_handled",
        node_id: "request",
        payload: { mode: "continue", error: { message: "HTTP 500" } },
      }),
    ];

    const states = buildNodeRunStates(workflowNodes, events, "succeeded");

    expect(states.request.status).toBe("handled");
    expect(states.request.executions).toHaveLength(1);
    expect(states.request.executions?.[0]).toMatchObject({
      status: "handled",
      error: { message: "HTTP 500" },
    });
  });

  it("keeps retry attempts with their individual execution records", () => {
    const events: RunEvent[] = [
      runEvent({ id: 1, type: "node_started", node_id: "request", payload: { attempt: 1, inputs: {} } }),
      runEvent({ id: 2, type: "node_failed", node_id: "request", payload: { attempt: 1, error: { message: "temporary" } } }),
      runEvent({
        id: 3,
        type: "node_retry_scheduled",
        node_id: "request",
        payload: { attempt: 1, next_attempt: 2, delay_ms: 0 },
      }),
      runEvent({ id: 4, type: "node_started", node_id: "request", payload: { attempt: 2, inputs: {} } }),
      runEvent({ id: 5, type: "node_succeeded", node_id: "request", payload: { attempt: 2, outputs: { success: {} } } }),
    ];

    const states = buildNodeRunStates(workflowNodes, events);

    expect(states.request.executions).toMatchObject([
      { attempt: 1, status: "failed" },
      { attempt: 2, status: "succeeded" },
    ]);
    expect(states.request.executions?.[0].events).toContainEqual(
      expect.objectContaining({ type: "node_retry_scheduled", attempt: 1, nextAttempt: 2, delayMs: 0 })
    );
  });

  it("keeps all executions for nodes that run multiple times", () => {
    const events: RunEvent[] = [
      runEvent({
        id: 1,
        type: "node_started",
        node_id: "request",
        scope: ["each", "iteration:0"],
        payload: { inputs: { row: 1 } },
      }),
      runEvent({
        id: 2,
        type: "node_succeeded",
        node_id: "request",
        scope: ["each", "iteration:0"],
        payload: { outputs: { success: [{ json: { ok: true } }] }, duration_ms: 4 },
      }),
      runEvent({
        id: 3,
        type: "node_started",
        node_id: "request",
        scope: ["each", "iteration:1"],
        payload: { inputs: { row: 2 } },
      }),
      runEvent({
        id: 4,
        type: "node_succeeded",
        node_id: "request",
        scope: ["each", "iteration:1"],
        payload: { outputs: { success: [{ json: { ok: false } }, { json: { ok: true } }] }, duration_ms: 6 },
      }),
    ];

    const states = buildNodeRunStates(workflowNodes, events);

    expect(states.request.executions).toHaveLength(2);
    expect(states.request.executions?.[0]).toMatchObject({
      runIndex: 0,
      status: "succeeded",
      scope: ["each", "iteration:0"],
      inputs: { row: 1 },
      inputItems: [{ json: { row: 1 } }],
      durationMs: 4,
    });
    expect(states.request.executions?.[0].outputs.success.items).toEqual([{ json: { ok: true } }]);
    expect(states.request.executions?.[1]).toMatchObject({
      runIndex: 1,
      status: "succeeded",
      scope: ["each", "iteration:1"],
      inputs: { row: 2 },
      inputItems: [{ json: { row: 2 } }],
      durationMs: 6,
    });
    expect(states.request.executions?.[1].outputs.success.items).toHaveLength(2);
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
