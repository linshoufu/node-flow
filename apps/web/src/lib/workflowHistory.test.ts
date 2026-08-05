import { describe, expect, it } from "vitest";
import {
  createWorkflowHistory,
  recordWorkflowHistory,
  redoWorkflowHistory,
  undoWorkflowHistory,
  type WorkflowHistoryEntry,
} from "./workflowHistory";

function entry(name: string): WorkflowHistoryEntry {
  return {
    workflow: {
      id: "workflow_history",
      name,
      version: 1,
      nodes: [],
      edges: [],
    },
    editScope: undefined,
    selectedNodeId: null,
  };
}

describe("workflow history", () => {
  it("returns the previous workflow snapshot and makes the current snapshot redoable", () => {
    const original = entry("初始流程");
    const edited = entry("已编辑流程");
    const recorded = recordWorkflowHistory(createWorkflowHistory(), original);

    const transition = undoWorkflowHistory(recorded, edited);

    expect(transition?.entry.workflow.name).toBe("初始流程");
    expect(transition?.history.past).toHaveLength(0);
    expect(transition?.history.future.map((item) => item.workflow.name)).toEqual(["已编辑流程"]);
  });

  it("restores the next snapshot when redoing an undone edit", () => {
    const original = entry("初始流程");
    const edited = entry("已编辑流程");
    const undone = undoWorkflowHistory(recordWorkflowHistory(createWorkflowHistory(), original), edited);

    const transition = redoWorkflowHistory(undone!.history, original);

    expect(transition?.entry.workflow.name).toBe("已编辑流程");
    expect(transition?.history.past.map((item) => item.workflow.name)).toEqual(["初始流程"]);
    expect(transition?.history.future).toEqual([]);
  });

  it("drops the redo branch when a new edit follows an undo", () => {
    const first = recordWorkflowHistory(createWorkflowHistory(), entry("初始流程"));
    const undone = undoWorkflowHistory(first, entry("已编辑流程"));

    const next = recordWorkflowHistory(undone!.history, entry("初始流程"));

    expect(next.future).toEqual([]);
    expect(next.past.map((item) => item.workflow.name)).toEqual(["初始流程"]);
  });

  it("keeps snapshots independent from later mutations and bounds the history size", () => {
    const mutable = entry("初始流程");
    const history = Array.from({ length: 82 }).reduce(
      (current, _unused, index) => recordWorkflowHistory(current, index === 0 ? mutable : entry(`流程 ${index}`)),
      createWorkflowHistory()
    );
    mutable.workflow.name = "被外部修改";

    expect(history.past).toHaveLength(80);
    expect(history.past[0]?.workflow.name).toBe("流程 2");
  });
});
