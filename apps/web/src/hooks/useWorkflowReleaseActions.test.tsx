import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkflow } from "../lib/workflow";
import type { WorkflowDocument, WorkflowUpgradePreview } from "../types";
import type { WorkflowMutationResult } from "./useWorkflowMutationController";
import { useWorkflowReleaseActions } from "./useWorkflowReleaseActions";

function workflow(version = 3): WorkflowDocument {
  return { ...createEmptyWorkflow(), id: "workflow-1", name: "Workflow", version };
}

function success<T>(value: T): WorkflowMutationResult<T> {
  return { kind: "success", value };
}

function preview(upgradeCount = 1): WorkflowUpgradePreview {
  return {
    workflow: workflow(),
    upgrades: Array.from({ length: upgradeCount }, (_, index) => ({
      nodeId: `node-${index + 1}`,
      path: `nodes.${index}`,
      nodeType: "test.node",
      fromVersion: 1,
      toVersion: 2,
      configChanges: [],
      migrationNotes: [],
    })),
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    acceptSavedWorkflow: vi.fn(),
    applyNodeUpgrades: vi.fn().mockResolvedValue(success(workflow(4))),
    clearWorkflowIssues: vi.fn(),
    currentWorkflow: workflow(),
    isEditorLocked: false,
    isWorkflowCurrent: vi.fn().mockReturnValue(true),
    isWorkflowDirty: false,
    nodeUpgradePreview: preview(2),
    onConflict: vi.fn().mockReturnValue(false),
    onMessage: vi.fn(),
    previewNodeUpgrades: vi.fn().mockResolvedValue(success(preview(1))),
    publication: null,
    replaceWorkflow: vi.fn(),
    selectedWorkflowId: "workflow-1",
    selectWorkflow: vi.fn().mockResolvedValue(undefined),
    updateActivation: vi.fn().mockResolvedValue(success(workflow(4))),
    upsertWorkflowSummary: vi.fn(),
    ...overrides,
  };
}

describe("useWorkflowReleaseActions", () => {
  it("publishes a clean draft and synchronizes its saved document", async () => {
    const published = { ...workflow(4), active: true };
    const current = options({ updateActivation: vi.fn().mockResolvedValue(success(published)) });
    const { result } = renderHook(() => useWorkflowReleaseActions(current as ReturnType<typeof options>));

    await act(() => result.current.updateWorkflowActivation());

    expect(current.updateActivation).toHaveBeenCalledWith("workflow-1", true, 3);
    expect(current.acceptSavedWorkflow).toHaveBeenCalledWith(published);
    expect(current.upsertWorkflowSummary).toHaveBeenCalledWith(published);
    expect(current.selectWorkflow).toHaveBeenCalledWith("workflow-1");
    expect(current.onMessage).toHaveBeenCalledWith("已发布工作流 v4。");
  });

  it("deactivates only a current production version", async () => {
    const stopped = { ...workflow(3), active: false };
    const current = options({
      publication: {
        workflow_id: "workflow-1",
        draft_version: 3,
        published_version: 3,
        active: true,
        has_unpublished_changes: false,
      },
      updateActivation: vi.fn().mockResolvedValue(success(stopped)),
    });
    const { result } = renderHook(() => useWorkflowReleaseActions(current as ReturnType<typeof options>));

    await act(() => result.current.updateWorkflowActivation());

    expect(current.updateActivation).toHaveBeenCalledWith("workflow-1", false, 3);
    expect(current.onMessage).toHaveBeenCalledWith("已停用生产版本。");
  });

  it("guards upgrade preview and reports empty, available, and failed checks", async () => {
    const unsaved = options({ selectedWorkflowId: "" });
    const { result, rerender } = renderHook(
      ({ current }) => useWorkflowReleaseActions(current as ReturnType<typeof options>),
      { initialProps: { current: unsaved } },
    );
    await act(() => result.current.previewWorkflowNodeUpgrades());
    expect(unsaved.onMessage).toHaveBeenCalledWith("请先保存工作流，再检查节点升级。");

    const empty = options({ previewNodeUpgrades: vi.fn().mockResolvedValue(success(preview(0))) });
    rerender({ current: empty });
    await act(() => result.current.previewWorkflowNodeUpgrades());
    expect(empty.onMessage).toHaveBeenCalledWith("当前工作流中的节点都已是最新版本。");

    const available = options({ previewNodeUpgrades: vi.fn().mockResolvedValue(success(preview(2))) });
    rerender({ current: available });
    await act(() => result.current.previewWorkflowNodeUpgrades());
    expect(available.onMessage).toHaveBeenCalledWith("发现 2 个可升级节点，请确认变更后应用。");

    const failed = options({ previewNodeUpgrades: vi.fn().mockResolvedValue({ kind: "error", error: new Error("offline") }) });
    rerender({ current: failed });
    await act(() => result.current.previewWorkflowNodeUpgrades());
    expect(failed.onMessage).toHaveBeenCalledWith("节点升级检查失败：offline");
  });

  it("applies node upgrades and clears issues from the replaced document", async () => {
    const upgraded = { ...workflow(6), name: "Upgraded" };
    const current = options({ applyNodeUpgrades: vi.fn().mockResolvedValue(success(upgraded)) });
    const { result } = renderHook(() => useWorkflowReleaseActions(current as ReturnType<typeof options>));

    await act(() => result.current.applyWorkflowNodeUpgrades());

    expect(current.applyNodeUpgrades).toHaveBeenCalledWith("workflow-1", 3);
    expect(current.replaceWorkflow).toHaveBeenCalledWith(upgraded, { baseline: "clean" });
    expect(current.upsertWorkflowSummary).toHaveBeenCalledWith(upgraded);
    expect(current.clearWorkflowIssues).toHaveBeenCalledTimes(1);
    expect(current.onMessage).toHaveBeenCalledWith("已升级 2 个节点并保存为 v6。");
  });

  it("routes activation and upgrade conflicts without adding a generic error message", async () => {
    const activationError = new Error("activation conflict");
    const upgradeError = new Error("upgrade conflict");
    const current = options({
      applyNodeUpgrades: vi.fn().mockResolvedValue({ kind: "error", error: upgradeError }),
      onConflict: vi.fn().mockReturnValue(true),
      updateActivation: vi.fn().mockResolvedValue({ kind: "error", error: activationError }),
    });
    const { result } = renderHook(() => useWorkflowReleaseActions(current as ReturnType<typeof options>));

    await act(() => result.current.updateWorkflowActivation());
    await act(() => result.current.applyWorkflowNodeUpgrades());

    expect(current.onConflict).toHaveBeenNthCalledWith(1, "activation", activationError);
    expect(current.onConflict).toHaveBeenNthCalledWith(2, "apply_upgrades", upgradeError);
    expect(current.onMessage).not.toHaveBeenCalled();
  });

  it("suppresses late release feedback after another workflow is selected", async () => {
    let finishSelection!: () => void;
    const selection = new Promise<void>((resolve) => {
      finishSelection = resolve;
    });
    const published = { ...workflow(5), active: true };
    const current = options({
      isWorkflowCurrent: vi.fn().mockReturnValue(false),
      selectWorkflow: vi.fn().mockReturnValue(selection),
      updateActivation: vi.fn().mockResolvedValue(success(published)),
    });
    const { result } = renderHook(() => useWorkflowReleaseActions(current as ReturnType<typeof options>));

    let operation!: Promise<void>;
    act(() => {
      operation = result.current.updateWorkflowActivation();
    });
    await vi.waitFor(() => expect(current.selectWorkflow).toHaveBeenCalled());
    expect(current.upsertWorkflowSummary).toHaveBeenCalledWith(published);
    finishSelection();
    await act(() => operation);

    expect(current.onMessage).not.toHaveBeenCalled();
  });
});
