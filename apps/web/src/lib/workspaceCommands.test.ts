import { describe, expect, it, vi } from "vitest";
import {
  buildWorkspaceCommands,
  DEFAULT_WORKSPACE_COMMAND_PROVIDERS,
  type WorkspaceCommandActions,
  type WorkspaceCommandState,
} from "./workspaceCommands";

function commandState(overrides: Partial<WorkspaceCommandState> = {}): WorkspaceCommandState {
  return {
    canCancelRun: false,
    canRedo: false,
    canUndo: false,
    isBusy: false,
    isCancelling: false,
    isEditorLocked: false,
    isNodeTypesReloading: false,
    saveAction: { disabled: false },
    ...overrides,
  };
}

function commandActions(): WorkspaceCommandActions {
  return {
    cancelRun: vi.fn(),
    fitCanvas: vi.fn(),
    newWorkflow: vi.fn(),
    openResource: vi.fn(),
    openWorkflowSettings: vi.fn(),
    redo: vi.fn(),
    reloadNodeTypes: vi.fn(),
    runWorkflow: vi.fn(),
    saveWorkflow: vi.fn(),
    undo: vi.fn(),
    validateWorkflow: vi.fn(),
  };
}

describe("buildWorkspaceCommands", () => {
  it("composes stable product command groups in Chinese", () => {
    const commands = buildWorkspaceCommands(commandState(), commandActions());
    expect(commands.map(({ id }) => id)).toEqual([
      "workflow-new",
      "workflow-save",
      "workflow-validate",
      "workflow-run",
      "workflow-cancel",
      "editor-undo",
      "editor-redo",
      "editor-fit",
      "editor-refresh-nodes",
      "settings-workflow",
      "resource-credentials",
      "resource-variables",
      "resource-environments",
      "resource-packages",
    ]);
    expect(commands.find(({ id }) => id === "workflow-run")).toMatchObject({ group: "工作流", label: "运行工作流" });
    expect(commands.find(({ id }) => id === "resource-packages")).toMatchObject({ group: "资源", label: "打开节点包管理" });
  });

  it("derives disabled reasons from shared editor state", () => {
    const commands = buildWorkspaceCommands(
      commandState({
        isBusy: true,
        isCancelling: true,
        isEditorLocked: true,
        isNodeTypesReloading: true,
        saveAction: { disabled: true, title: "没有需要保存的更改" },
      }),
      commandActions(),
    );
    expect(commands.find(({ id }) => id === "workflow-save")?.disabledReason).toBe("没有需要保存的更改");
    expect(commands.find(({ id }) => id === "workflow-cancel")?.disabledReason).toBe("正在请求取消");
    expect(commands.find(({ id }) => id === "editor-undo")?.disabledReason).toBe("编辑器暂时锁定");
    expect(commands.find(({ id }) => id === "editor-refresh-nodes")?.disabledReason).toBe("正在刷新节点库");
    expect(commands.find(({ id }) => id === "resource-credentials")?.disabled).toBe(true);
  });

  it("dispatches resource and workflow actions without embedding UI state", () => {
    const actions = commandActions();
    const commands = buildWorkspaceCommands(commandState({ canCancelRun: true, canUndo: true }), actions);
    commands.find(({ id }) => id === "workflow-run")?.onSelect();
    commands.find(({ id }) => id === "editor-undo")?.onSelect();
    commands.find(({ id }) => id === "resource-environments")?.onSelect();
    expect(actions.runWorkflow).toHaveBeenCalledTimes(1);
    expect(actions.undo).toHaveBeenCalledTimes(1);
    expect(actions.openResource).toHaveBeenCalledWith("environments");
  });

  it("accepts feature command providers without changing the central registry", () => {
    const commands = buildWorkspaceCommands(commandState(), commandActions(), [
      ...DEFAULT_WORKSPACE_COMMAND_PROVIDERS,
      () => [{
        id: "feature-open-data",
        group: "数据",
        icon: "variables",
        label: "打开数据表",
        onSelect: vi.fn(),
      }],
    ]);
    expect(commands.at(-1)).toMatchObject({ id: "feature-open-data", group: "数据", label: "打开数据表" });
  });
});
