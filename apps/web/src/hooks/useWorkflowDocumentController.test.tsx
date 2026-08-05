import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createEmptyWorkflow, type EditScope } from "../lib/workflow";
import type { WorkflowDocument } from "../types";
import { useWorkflowDocumentController } from "./useWorkflowDocumentController";

function workflow(name: string): WorkflowDocument {
  return { ...createEmptyWorkflow(), name };
}

const rootContext = { editScope: undefined, selectedNodeId: null };

describe("useWorkflowDocumentController", () => {
  it("derives draft, dirty, and saved states from the document baseline", () => {
    const initialWorkflow = workflow("Draft");
    const { result, rerender } = renderHook(
      ({ selectedWorkflowId }) => useWorkflowDocumentController({
        initialWorkflow,
        selectedWorkflowId,
      }),
      { initialProps: { selectedWorkflowId: "" } },
    );

    expect(result.current.saveState.label).toBe("草稿");
    act(() => result.current.commitChange(
      (current) => ({ ...current, name: "Changed" }),
      rootContext,
    ));
    expect(result.current.saveState.label).toBe("未保存");

    act(() => result.current.acceptSavedWorkflow({ ...result.current.workflow, id: "wf-1" }));
    rerender({ selectedWorkflowId: "wf-1" });
    expect(result.current.saveState.label).toBe("已保存");
  });

  it("records document changes and restores workflow context with undo and redo", () => {
    const { result } = renderHook(() => useWorkflowDocumentController({
      initialWorkflow: workflow("Initial"),
      selectedWorkflowId: "wf-1",
    }));
    const editScope: EditScope = [{ nodeId: "loop", subflowName: "body" }];

    act(() => result.current.commitChange(
      (current) => ({ ...current, name: "Changed" }),
      { editScope, selectedNodeId: "node-1" },
    ));
    expect(result.current.canUndo).toBe(true);

    let restoredContext: ReturnType<typeof result.current.undo> = null;
    act(() => {
      restoredContext = result.current.undo(rootContext);
    });
    expect(result.current.workflow.name).toBe("Initial");
    expect(restoredContext?.editScope).toEqual(editScope);
    expect(restoredContext?.selectedNodeId).toBe("node-1");
    expect(result.current.canRedo).toBe(true);

    act(() => {
      restoredContext = result.current.redo(rootContext);
    });
    expect(result.current.workflow.name).toBe("Changed");
    expect(restoredContext?.editScope).toBeUndefined();
  });

  it("records one undo entry for a grouped drag interaction", () => {
    const { result } = renderHook(() => useWorkflowDocumentController({
      initialWorkflow: workflow("Initial"),
      selectedWorkflowId: "wf-1",
    }));

    act(() => {
      result.current.setHistoryGroupActive(true);
      result.current.commitChange((current) => ({ ...current, name: "Drag 1" }), rootContext);
      result.current.commitChange((current) => ({ ...current, name: "Drag 2" }), rootContext);
      result.current.setHistoryGroupActive(false);
    });

    expect(result.current.history.past).toHaveLength(1);
    act(() => {
      result.current.undo(rootContext);
    });
    expect(result.current.workflow.name).toBe("Initial");
  });

  it("does not record a no-op change", () => {
    const initialWorkflow = workflow("Initial");
    const { result } = renderHook(() => useWorkflowDocumentController({
      initialWorkflow,
      selectedWorkflowId: "wf-1",
    }));

    let changed = true;
    act(() => {
      changed = result.current.commitChange((current) => current, rootContext);
    });

    expect(changed).toBe(false);
    expect(result.current.history.past).toHaveLength(0);
  });

  it("preserves undo history when a changed document is accepted as saved", () => {
    const { result } = renderHook(() => useWorkflowDocumentController({
      initialWorkflow: workflow("Initial"),
      selectedWorkflowId: "wf-1",
    }));
    act(() => result.current.commitChange(
      (current) => ({ ...current, name: "Changed" }),
      rootContext,
    ));
    act(() => result.current.acceptSavedWorkflow(result.current.workflow));

    expect(result.current.saveState.label).toBe("已保存");
    expect(result.current.canUndo).toBe(true);
    act(() => {
      result.current.undo(rootContext);
    });
    expect(result.current.workflow.name).toBe("Initial");
    expect(result.current.saveState.label).toBe("未保存");
  });

  it("rebases edits and undo history made while a save request is in flight", () => {
    const initial = { ...workflow("Initial"), id: "wf-1", version: 1 };
    const { result } = renderHook(() => useWorkflowDocumentController({
      initialWorkflow: initial,
      selectedWorkflowId: "wf-1",
    }));
    act(() => result.current.commitChange(
      (current) => ({ ...current, name: "Requested" }),
      rootContext,
    ));
    const requestRevision = result.current.revision;
    act(() => result.current.commitChange(
      (current) => ({ ...current, name: "Edited while saving" }),
      rootContext,
    ));

    let acceptance!: ReturnType<typeof result.current.acceptSavedWorkflow>;
    act(() => {
      acceptance = result.current.acceptSavedWorkflow(
        { ...result.current.workflow, name: "Requested", version: 2 },
        { requestRevision },
      );
    });

    expect(acceptance.preservedNewerChanges).toBe(true);
    expect(result.current.workflow).toMatchObject({ name: "Edited while saving", version: 2 });
    expect(result.current.saveState.label).toBe("未保存");
    act(() => {
      result.current.undo(rootContext);
    });
    expect(result.current.workflow).toMatchObject({ name: "Requested", version: 2 });
  });

  it("replaces documents with explicit clean or dirty baselines and resets history", () => {
    const { result } = renderHook(() => useWorkflowDocumentController({
      initialWorkflow: workflow("Initial"),
      selectedWorkflowId: "wf-1",
    }));
    act(() => result.current.commitChange(
      (current) => ({ ...current, name: "Changed" }),
      rootContext,
    ));

    act(() => result.current.replaceWorkflow(workflow("Template"), { baseline: "dirty" }));
    expect(result.current.workflow.name).toBe("Template");
    expect(result.current.saveState.label).toBe("未保存");
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.replaceWorkflow(workflow("Loaded"), { baseline: "clean" }));
    expect(result.current.workflow.name).toBe("Loaded");
    expect(result.current.saveState.label).toBe("已保存");
  });
});
