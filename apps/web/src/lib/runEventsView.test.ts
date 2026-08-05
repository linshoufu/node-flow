import { describe, expect, it } from "vitest";
import type { RunEvent } from "../types";
import { filterRunEvents } from "./runEventsView";

describe("run events view helpers", () => {
  it("filters run events by translated event label, node display name, scope, and payload", () => {
    const events: RunEvent[] = [
      runEvent({
        id: 1,
        type: "node_succeeded",
        node_id: "request",
        payload: { outputs: { success: { status_code: 200 } } },
      }),
      runEvent({
        id: 2,
        type: "node_failed",
        node_id: "assert",
        scope: ["each", "iteration:0"],
        payload: { error: { message: "status mismatch" } },
      }),
      runEvent({
        id: 3,
        type: "run_failed",
        node_id: null,
        payload: { error: "workflow failed" },
      }),
    ];

    expect(filterRunEvents(events, "\u72b6\u6001\u65ad\u8a00", { assert: "\u72b6\u6001\u65ad\u8a00" }).map((event) => event.id)).toEqual([
      2,
    ]);
    expect(filterRunEvents(events, "\u8282\u70b9\u5931\u8d25", {}).map((event) => event.id)).toEqual([2]);
    expect(filterRunEvents(events, "iteration:0", {}).map((event) => event.id)).toEqual([2]);
    expect(filterRunEvents(events, "workflow failed", {}).map((event) => event.id)).toEqual([3]);
    expect(filterRunEvents(events, "", {}).map((event) => event.id)).toEqual([1, 2, 3]);
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
