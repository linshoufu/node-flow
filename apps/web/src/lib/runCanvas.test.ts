import { describe, expect, it } from "vitest";
import type { RunEvent, RunRecord, WorkflowDocument } from "@/types";
import { findRunNodeScope, nodeRunStatus } from "./runCanvas";

const workflow: WorkflowDocument = { id: "wf", name: "Snapshot", version: 2, edges: [], nodes: [
  { id: "request", type: "http.request", config: {}, position: { x: 0, y: 0 } },
  { id: "loop", type: "control.each_item", label: "逐项处理", config: {}, position: { x: 0, y: 0 }, subflows: {
    body: { nodes: [{ id: "request", type: "http.request", config: {}, position: { x: 0, y: 0 } }], edges: [] },
  } },
] };

describe("execution graph presentation", () => {
  it("locates a nested node using its execution scope without changing the snapshot", () => {
    const before = structuredClone(workflow);
    expect(findRunNodeScope(workflow, "request", ["loop", "iteration:2"])).toEqual([{ nodeId: "loop", key: "body", label: "逐项处理" }]);
    expect(findRunNodeScope(workflow, "request", [])).toEqual([]);
    expect(findRunNodeScope(workflow, "missing", [])).toBeNull();
    expect(workflow).toEqual(before);
  });

  it("shows the latest node result and waiting nodes during an active run", () => {
    const run = { status: "running" } as RunRecord;
    const events = [{ node_id: "request", type: "node_started", payload: {} }, { node_id: "request", type: "node_failed", payload: {} }] as RunEvent[];
    expect(nodeRunStatus("request", undefined, run, events)).toBe("failed");
    expect(nodeRunStatus("other", undefined, run, events)).toBe("waiting");
    expect(nodeRunStatus("request", undefined, null, events)).toBeNull();
  });

  it("distinguishes planned effects and unverified steps from executed success", () => {
    const run = { status: "succeeded", run_mode: "preview" } as RunRecord;
    const events = [{ node_id: "write", type: "node_previewed", payload: { effects: [{ operation: "create" }] } },
      { node_id: "write", type: "node_succeeded", payload: { outputs: {}, run_mode: "preview" } },
      { node_id: "next", type: "node_not_verified", payload: {} }] as RunEvent[];
    expect(nodeRunStatus("write", undefined, run, events)).toBe("planned");
    expect(nodeRunStatus("next", undefined, run, events)).toBe("unverified");
  });
});
