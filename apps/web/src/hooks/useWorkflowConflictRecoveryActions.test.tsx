import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkflow } from "../lib/workflow";
import type { WorkflowDocument } from "../types";
import type { WorkflowConflict } from "./useWorkflowConflictController";
import { useWorkflowConflictRecoveryActions } from "./useWorkflowConflictRecoveryActions";

function workflow(id = "workflow-1", version = 3): WorkflowDocument {
  return {
    ...createEmptyWorkflow(),
    id,
    name: `工作流 ${id}`,
    version,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const saveConflict: WorkflowConflict = {
  action: "save",
  currentVersion: 4,
  expectedVersion: 3,
};

function options(overrides: Record<string, unknown> = {}) {
  return {
    clearConflict: vi.fn(),
    client: { getWorkflow: vi.fn().mockResolvedValue(workflow("workflow-1", 4)) },
    commitWorkflowSave: vi.fn(),
    conflict: saveConflict,
    currentWorkflow: workflow(),
    isPageBusy: false,
    isWorkflowMutating: false,
    navigate: vi.fn(),
    onBusyChange: vi.fn(),
    onClearIssues: vi.fn(),
    onMessage: vi.fn(),
    onResetAutoSave: vi.fn(),
    onResetEditor: vi.fn(),
    replaceWorkflow: vi.fn(),
    selectedWorkflowId: "workflow-1",
    selectWorkflow: vi.fn().mockResolvedValue(undefined),
    upsertWorkflowSummary: vi.fn(),
    ...overrides,
  };
}

describe("useWorkflowConflictRecoveryActions", () => {
  it("重新加载服务器版本并重置冲突相关状态", async () => {
    const loaded = workflow("workflow-1", 4);
    const current = options({ client: { getWorkflow: vi.fn().mockResolvedValue(loaded) } });
    const { result } = renderHook(() => useWorkflowConflictRecoveryActions(current));

    await act(() => result.current.reloadWorkflowAfterConflict());

    expect(current.client.getWorkflow).toHaveBeenCalledWith("workflow-1");
    expect(current.replaceWorkflow).toHaveBeenCalledWith(loaded, { baseline: "clean" });
    expect(current.selectWorkflow).toHaveBeenCalledWith("workflow-1");
    expect(current.upsertWorkflowSummary).toHaveBeenCalledWith(loaded);
    expect(current.onResetEditor).toHaveBeenCalledOnce();
    expect(current.onClearIssues).toHaveBeenCalledOnce();
    expect(current.clearConflict).toHaveBeenCalledOnce();
    expect(current.onResetAutoSave).toHaveBeenCalledOnce();
    expect(current.onMessage).toHaveBeenCalledWith("已重新加载服务器版本 v4。");
    expect(current.onBusyChange).toHaveBeenNthCalledWith(1, true);
    expect(current.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("重新加载失败时保留冲突并恢复忙碌状态", async () => {
    const current = options({
      client: { getWorkflow: vi.fn().mockRejectedValue(new Error("offline")) },
    });
    const { result } = renderHook(() => useWorkflowConflictRecoveryActions(current));

    await act(() => result.current.reloadWorkflowAfterConflict());

    expect(current.replaceWorkflow).not.toHaveBeenCalled();
    expect(current.clearConflict).not.toHaveBeenCalled();
    expect(current.onMessage).toHaveBeenCalledWith("重新加载工作流失败：offline");
    expect(current.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("切换文档后忽略迟到的重新加载结果", async () => {
    const pending = deferred<WorkflowDocument>();
    const current = options({ client: { getWorkflow: vi.fn().mockReturnValue(pending.promise) } });
    const { result, rerender } = renderHook(
      ({ currentOptions }) => useWorkflowConflictRecoveryActions(currentOptions),
      { initialProps: { currentOptions: current } },
    );

    let request!: Promise<void>;
    act(() => {
      request = result.current.reloadWorkflowAfterConflict();
    });
    rerender({ currentOptions: options({
      ...current,
      currentWorkflow: workflow("workflow-2", 1),
      selectedWorkflowId: "workflow-2",
    }) });
    await act(async () => {
      pending.resolve(workflow("workflow-1", 4));
      await request;
    });

    expect(current.replaceWorkflow).not.toHaveBeenCalled();
    expect(current.clearConflict).not.toHaveBeenCalled();
    expect(current.onMessage).not.toHaveBeenCalled();
    expect(current.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("只有保存冲突可以另存为副本", async () => {
    const current = options({
      conflict: { ...saveConflict, action: "activation" },
    });
    const { result } = renderHook(() => useWorkflowConflictRecoveryActions(current));

    await act(() => result.current.saveWorkflowConflictAsCopy());

    expect(current.commitWorkflowSave).not.toHaveBeenCalled();
    expect(current.onBusyChange).not.toHaveBeenCalled();
  });

  it("将当前画布另存为新工作流并同步路由", async () => {
    const saved = workflow("workflow-copy", 1);
    const current = options({
      commitWorkflowSave: vi.fn().mockResolvedValue({ kind: "success", value: saved }),
    });
    const { result } = renderHook(() => useWorkflowConflictRecoveryActions(current));

    await act(() => result.current.saveWorkflowConflictAsCopy());

    expect(current.commitWorkflowSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.not.stringMatching(/^workflow-1$/) }),
      undefined,
      "manual",
      "workflow-1",
    );
    expect(current.replaceWorkflow).toHaveBeenCalledWith(saved, { baseline: "clean" });
    expect(current.navigate).toHaveBeenCalledWith({
      kind: "workflow",
      workflowId: "workflow-copy",
    });
    expect(current.clearConflict).toHaveBeenCalledOnce();
    expect(current.onMessage).toHaveBeenCalledWith(
      "已保留当前修改，并另存为“工作流 workflow-copy” v1。",
    );
  });

  it("另存失败时保留当前文档和冲突", async () => {
    const current = options({
      commitWorkflowSave: vi.fn().mockResolvedValue({
        kind: "error",
        error: new Error("disk full"),
      }),
    });
    const { result } = renderHook(() => useWorkflowConflictRecoveryActions(current));

    await act(() => result.current.saveWorkflowConflictAsCopy());

    expect(current.replaceWorkflow).not.toHaveBeenCalled();
    expect(current.clearConflict).not.toHaveBeenCalled();
    expect(current.onMessage).toHaveBeenCalledWith("另存为副本失败：disk full");
    expect(current.onBusyChange).toHaveBeenLastCalledWith(false);
  });
});
