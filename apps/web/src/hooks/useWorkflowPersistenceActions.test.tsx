import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PreRunIssue } from "../lib/preRunChecks";
import { createEmptyWorkflow } from "../lib/workflow";
import type { WorkflowDocument } from "../types";
import type { WorkflowMutationResult } from "./useWorkflowMutationController";
import { useWorkflowPersistenceActions } from "./useWorkflowPersistenceActions";

function workflow(version = 3): WorkflowDocument {
  return { ...createEmptyWorkflow(), id: "workflow-1", name: "Workflow", version };
}

function success(value: WorkflowDocument): WorkflowMutationResult<WorkflowDocument> {
  return { kind: "success", value };
}

function settingsIssue(): PreRunIssue {
  return {
    id: "root:settings:timeout_seconds",
    severity: "error",
    title: "工作流设置不合法",
    message: "运行超时无效",
    targetKind: "settings",
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    acceptSavedWorkflow: vi.fn().mockReturnValue({ preservedNewerChanges: false }),
    commitWorkflowSave: vi.fn().mockResolvedValue(success(workflow(4))),
    currentPreRunIssues: [],
    isWorkflowDirty: true,
    onClearIssues: vi.fn(),
    onConflict: vi.fn().mockReturnValue(false),
    onMessage: vi.fn(),
    onNavigateToWorkflow: vi.fn(),
    onShowSettingsIssues: vi.fn(),
    selectedWorkflowId: "workflow-1",
    selectWorkflow: vi.fn().mockResolvedValue(undefined),
    upsertWorkflowSummary: vi.fn(),
    workflow: workflow(),
    workflowRevision: 7,
    ...overrides,
  };
}

describe("useWorkflowPersistenceActions", () => {
  it("在手动保存前显示设置问题并阻止请求", async () => {
    const current = options({ currentPreRunIssues: [settingsIssue()] });
    const { result } = renderHook(() => useWorkflowPersistenceActions(current));

    await act(() => result.current.saveWorkflow());

    expect(current.commitWorkflowSave).not.toHaveBeenCalled();
    expect(current.onShowSettingsIssues).toHaveBeenCalledOnce();
    expect(current.onMessage).toHaveBeenCalledWith("保存前检查发现 1 个问题，请先补齐配置。");
  });

  it("自动保存遇到设置问题时保持安静", async () => {
    const current = options({ currentPreRunIssues: [settingsIssue()] });
    const { result } = renderHook(() => useWorkflowPersistenceActions(current));

    let saveResult;
    await act(async () => {
      saveResult = await result.current.saveWorkflowAutomatically();
    });

    expect(saveResult).toEqual({ kind: "invalid" });
    expect(current.onShowSettingsIssues).not.toHaveBeenCalled();
    expect(current.onMessage).not.toHaveBeenCalled();
  });

  it("不会为没有改动的已保存工作流创建新版本", async () => {
    const current = options({ isWorkflowDirty: false });
    const { result } = renderHook(() => useWorkflowPersistenceActions(current));

    let saved;
    await act(async () => {
      saved = await result.current.saveWorkflow();
    });

    expect(saved).toEqual(current.workflow);
    expect(current.commitWorkflowSave).not.toHaveBeenCalled();
    expect(current.onMessage).toHaveBeenCalledWith("没有需要保存的修改。");
  });

  it("首次保存后同步文档、目录和持久路由", async () => {
    const savedWorkflow = { ...workflow(1), id: "saved-1" };
    const current = options({
      commitWorkflowSave: vi.fn().mockResolvedValue(success(savedWorkflow)),
      selectedWorkflowId: "",
      workflow: { ...createEmptyWorkflow(), id: "draft-local" },
    });
    const { result } = renderHook(() => useWorkflowPersistenceActions(current));

    await act(() => result.current.saveWorkflow());

    expect(current.commitWorkflowSave).toHaveBeenCalledWith(expect.any(Object), undefined, "manual");
    expect(current.acceptSavedWorkflow).toHaveBeenCalledWith(savedWorkflow, { requestRevision: 7 });
    expect(current.selectWorkflow).toHaveBeenCalledWith("saved-1");
    expect(current.upsertWorkflowSummary).toHaveBeenCalledWith(savedWorkflow);
    expect(current.onNavigateToWorkflow).toHaveBeenCalledWith("saved-1");
    expect(current.onClearIssues).toHaveBeenCalledOnce();
    expect(current.onMessage).toHaveBeenCalledWith("已保存 v1。");
  });

  it("保留保存请求期间产生的新修改", async () => {
    const savedWorkflow = workflow(4);
    const current = options({
      acceptSavedWorkflow: vi.fn().mockReturnValue({ preservedNewerChanges: true }),
      commitWorkflowSave: vi.fn().mockResolvedValue(success(savedWorkflow)),
    });
    const { result } = renderHook(() => useWorkflowPersistenceActions(current));

    let saveResult;
    await act(async () => {
      saveResult = await result.current.saveWorkflowAutomatically();
    });

    expect(saveResult).toEqual({ kind: "success", pendingChanges: true });
    expect(current.onClearIssues).not.toHaveBeenCalled();
    expect(current.onMessage).not.toHaveBeenCalled();
  });

  it("将版本冲突转换为自动保存可识别的结果", async () => {
    const conflict = new Error("version conflict");
    const current = options({
      commitWorkflowSave: vi.fn().mockResolvedValue({ kind: "error", error: conflict }),
      onConflict: vi.fn().mockReturnValue(true),
    });
    const { result } = renderHook(() => useWorkflowPersistenceActions(current));

    let saveResult;
    await act(async () => {
      saveResult = await result.current.saveWorkflowAutomatically();
    });

    expect(current.onConflict).toHaveBeenCalledWith("save", conflict);
    expect(saveResult).toEqual({ kind: "conflict", error: conflict });
    expect(current.onMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["busy", "已有工作流变更正在处理，请稍候。"],
    ["stale", null],
    ["error", "保存失败：offline"],
  ] as const)("统一处理 %s 保存结果", async (kind, expectedMessage) => {
    const mutationResult = kind === "error"
      ? { kind, error: new Error("offline") }
      : { kind };
    const current = options({ commitWorkflowSave: vi.fn().mockResolvedValue(mutationResult) });
    const { result } = renderHook(() => useWorkflowPersistenceActions(current));

    await act(() => result.current.saveWorkflow());

    if (expectedMessage) {
      expect(current.onMessage).toHaveBeenCalledWith(expectedMessage);
    } else {
      expect(current.onMessage).not.toHaveBeenCalled();
    }
  });
});
