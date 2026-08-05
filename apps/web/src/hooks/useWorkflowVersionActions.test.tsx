import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkflow } from "../lib/workflow";
import type { WorkflowDocument } from "../types";
import type { WorkflowMutationResult } from "./useWorkflowMutationController";
import { useWorkflowVersionActions } from "./useWorkflowVersionActions";

function workflow(version = 3): WorkflowDocument {
  return { ...createEmptyWorkflow(), id: "workflow-1", name: "Workflow", version };
}

function success(value: WorkflowDocument): WorkflowMutationResult<WorkflowDocument> {
  return { kind: "success", value };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    clearVersionDiff: vi.fn(),
    compareVersion: vi.fn().mockResolvedValue(null),
    currentWorkflow: workflow(),
    isEditorLocked: false,
    isRollingBack: false,
    isWorkflowCurrent: vi.fn().mockReturnValue(true),
    isWorkflowDirty: false,
    onConflict: vi.fn().mockReturnValue(false),
    onMessage: vi.fn(),
    refreshVersions: vi.fn().mockResolvedValue([]),
    replaceWorkflow: vi.fn(),
    restoreVersion: vi.fn().mockResolvedValue(success(workflow(4))),
    rollbackVersion: vi.fn().mockResolvedValue(success(workflow(4))),
    selectedWorkflowId: "workflow-1",
    selectWorkflow: vi.fn().mockResolvedValue(undefined),
    setRollbackTargetVersion: vi.fn(),
    toggleTriggersPanel: vi.fn(),
    toggleVersionsPanel: vi.fn(),
    upsertWorkflowSummary: vi.fn(),
    ...overrides,
  };
}

describe("useWorkflowVersionActions", () => {
  it("guards version and trigger panels with product-level messages", () => {
    const unsaved = options({ selectedWorkflowId: "" });
    const { result, rerender } = renderHook(
      ({ current }) => useWorkflowVersionActions(current as ReturnType<typeof options>),
      { initialProps: { current: unsaved } },
    );

    act(() => {
      result.current.toggleWorkflowVersions();
      result.current.toggleWorkflowTriggers();
    });
    expect(unsaved.toggleVersionsPanel).not.toHaveBeenCalled();
    expect(unsaved.toggleTriggersPanel).not.toHaveBeenCalled();
    expect(unsaved.onMessage).toHaveBeenNthCalledWith(1, "请先保存工作流，再查看版本历史。");
    expect(unsaved.onMessage).toHaveBeenNthCalledWith(2, "请先保存工作流，再查看触发器状态。");

    const dirty = options({ isWorkflowDirty: true });
    rerender({ current: dirty });
    act(() => result.current.toggleWorkflowTriggers());
    expect(dirty.toggleTriggersPanel).not.toHaveBeenCalled();
    expect(dirty.onMessage).toHaveBeenCalledWith("当前工作流有未保存变更，请先保存后再查看触发器状态。");
  });

  it("compares only an eligible historical version", async () => {
    const eligible = options();
    const { result, rerender } = renderHook(
      ({ current }) => useWorkflowVersionActions(current as ReturnType<typeof options>),
      { initialProps: { current: eligible } },
    );

    await act(() => result.current.compareWorkflowVersion(3));
    expect(eligible.compareVersion).not.toHaveBeenCalled();
    await act(() => result.current.compareWorkflowVersion(2));
    expect(eligible.compareVersion).toHaveBeenCalledWith(2);

    const locked = options({ isEditorLocked: true });
    rerender({ current: locked });
    await act(() => result.current.compareWorkflowVersion(2));
    expect(locked.compareVersion).not.toHaveBeenCalled();
  });

  it("restores a version and synchronizes the document, catalog, and lifecycle state", async () => {
    const restored = { ...workflow(7), name: "Restored" };
    const current = options({ restoreVersion: vi.fn().mockResolvedValue(success(restored)) });
    const { result } = renderHook(() => useWorkflowVersionActions(current as ReturnType<typeof options>));

    await act(() => result.current.restoreWorkflowVersion(2));

    expect(current.restoreVersion).toHaveBeenCalledWith("workflow-1", 2, 3);
    expect(current.replaceWorkflow).toHaveBeenCalledWith(restored, { baseline: "clean" });
    expect(current.clearVersionDiff).toHaveBeenCalledTimes(1);
    expect(current.setRollbackTargetVersion).toHaveBeenCalledWith(null);
    expect(current.selectWorkflow).toHaveBeenCalledWith("workflow-1");
    expect(current.upsertWorkflowSummary).toHaveBeenCalledWith(restored);
    expect(current.refreshVersions).toHaveBeenCalledTimes(1);
    expect(current.onMessage).toHaveBeenCalledWith("已恢复 v2，并保存为草稿 v7。");
  });

  it("rolls production back and synchronizes the new published document", async () => {
    const rolledBack = { ...workflow(8), name: "Rollback" };
    const current = options({ rollbackVersion: vi.fn().mockResolvedValue(success(rolledBack)) });
    const { result } = renderHook(() => useWorkflowVersionActions(current as ReturnType<typeof options>));

    await act(() => result.current.rollbackWorkflowVersion(1));

    expect(current.rollbackVersion).toHaveBeenCalledWith("workflow-1", 1, 3);
    expect(current.replaceWorkflow).toHaveBeenCalledWith(rolledBack, { baseline: "clean" });
    expect(current.selectWorkflow).toHaveBeenCalledWith("workflow-1");
    expect(current.upsertWorkflowSummary).toHaveBeenCalledWith(rolledBack);
    expect(current.refreshVersions).toHaveBeenCalledTimes(1);
    expect(current.onMessage).toHaveBeenCalledWith("已将生产版本回滚到 v1，并创建 v8。");
  });

  it("does not apply late lifecycle feedback after the user switches workflows", async () => {
    let finishSelection!: () => void;
    const selection = new Promise<void>((resolve) => {
      finishSelection = resolve;
    });
    const restored = { ...workflow(9), name: "Restored" };
    const current = options({
      isWorkflowCurrent: vi.fn().mockReturnValue(false),
      restoreVersion: vi.fn().mockResolvedValue(success(restored)),
      selectWorkflow: vi.fn().mockReturnValue(selection),
    });
    const { result } = renderHook(() => useWorkflowVersionActions(current as ReturnType<typeof options>));

    let operation!: Promise<void>;
    act(() => {
      operation = result.current.restoreWorkflowVersion(2);
    });
    await vi.waitFor(() => {
      expect(current.selectWorkflow).toHaveBeenCalledWith("workflow-1");
    });
    expect(current.upsertWorkflowSummary).toHaveBeenCalledWith(restored);
    finishSelection();
    await act(() => operation);

    expect(current.onMessage).not.toHaveBeenCalled();
    expect(current.refreshVersions).not.toHaveBeenCalled();
  });

  it("handles busy, stale, ordinary error, and conflict mutation outcomes", async () => {
    const current = options({
      restoreVersion: vi.fn()
        .mockResolvedValueOnce({ kind: "busy" })
        .mockResolvedValueOnce({ kind: "stale" })
        .mockResolvedValueOnce({ kind: "error", error: new Error("network") })
        .mockResolvedValueOnce({ kind: "error", error: new Error("conflict") }),
    });
    const { result } = renderHook(() => useWorkflowVersionActions(current as ReturnType<typeof options>));

    await act(() => result.current.restoreWorkflowVersion(1));
    expect(current.onMessage).toHaveBeenLastCalledWith("已有工作流变更正在处理，请稍候。");
    await act(() => result.current.restoreWorkflowVersion(1));
    expect(current.onMessage).toHaveBeenCalledTimes(1);
    await act(() => result.current.restoreWorkflowVersion(1));
    expect(current.onMessage).toHaveBeenLastCalledWith("恢复工作流版本失败：network");
    current.onConflict.mockReturnValueOnce(true);
    await act(() => result.current.restoreWorkflowVersion(1));
    expect(current.onConflict).toHaveBeenLastCalledWith("restore", expect.any(Error));
    expect(current.onMessage).toHaveBeenCalledTimes(2);
  });

  it("does not start restore or rollback while the editor state forbids mutations", async () => {
    const current = options({ isEditorLocked: true, isRollingBack: true, isWorkflowDirty: true });
    const { result } = renderHook(() => useWorkflowVersionActions(current as ReturnType<typeof options>));

    await act(() => result.current.restoreWorkflowVersion(1));
    await act(() => result.current.rollbackWorkflowVersion(1));

    expect(current.restoreVersion).not.toHaveBeenCalled();
    expect(current.rollbackVersion).not.toHaveBeenCalled();
  });
});
