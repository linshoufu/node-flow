import { describe, expect, it } from "vitest";
import type { RunEvent } from "../types";
import { buildRunComparison } from "./runComparison";

describe("buildRunComparison", () => {
  it("marks a node as changed when its final status or execution summary differs", () => {
    const comparison = buildRunComparison(
      [
        event({ type: "node_succeeded", node_id: "request", payload: { outputs: { success: [{ id: 1 }] } } }),
        event({ type: "node_succeeded", node_id: "assert", payload: { outputs: { success: { passed: true } } } }),
      ],
      [
        event({ type: "node_succeeded", node_id: "request", payload: { outputs: { success: [{ id: 1 }, { id: 2 }] } } }),
        event({ type: "node_failed", node_id: "assert", payload: { error: { message: "状态码不匹配" } } }),
        event({ type: "node_succeeded", node_id: "new_node", payload: { outputs: { success: {} } } }),
      ]
    );

    expect(comparison.changedNodeCount).toBe(3);
    expect(comparison.nodes).toEqual([
      expect.objectContaining({ nodeId: "request", change: "changed", current: expect.objectContaining({ outputItemCount: 2 }) }),
      expect.objectContaining({ nodeId: "assert", change: "changed", baseline: expect.objectContaining({ latestStatus: "succeeded" }), current: expect.objectContaining({ latestStatus: "failed" }) }),
      expect.objectContaining({ nodeId: "new_node", change: "added", baseline: null, current: expect.objectContaining({ latestStatus: "succeeded" }) }),
    ]);
  });

  it("keeps unchanged nodes available so a comparison explains the complete run", () => {
    const events = [event({ type: "node_succeeded", node_id: "request", payload: { outputs: { success: { ok: true } } } })];

    const comparison = buildRunComparison(events, events);

    expect(comparison).toMatchObject({ nodeCount: 1, changedNodeCount: 0, unchangedNodeCount: 1 });
    expect(comparison.nodes[0]).toMatchObject({ nodeId: "request", change: "unchanged" });
  });
});

function event(overrides: Partial<RunEvent>): RunEvent {
  return {
    run_id: "run_1",
    type: "node_started",
    timestamp: "2026-07-23T00:00:00Z",
    node_id: null,
    scope: [],
    payload: {},
    ...overrides,
  };
}
