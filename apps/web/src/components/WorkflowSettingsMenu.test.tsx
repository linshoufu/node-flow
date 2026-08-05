import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkflow } from "../lib/workflow";
import type { WorkflowSettingsActions } from "./WorkflowSettingsPopover";
import { WorkflowSettingsMenu } from "./WorkflowSettingsMenu";

afterEach(cleanup);

function actions(): Omit<WorkflowSettingsActions, "onClose"> {
  return {
    onAddTag: vi.fn(),
    onAddVariable: vi.fn(),
    onAutoSaveChange: vi.fn(),
    onCompareVersion: vi.fn(),
    onDescriptionChange: vi.fn(),
    onEnvironmentChange: vi.fn(),
    onErrorWorkflowChange: vi.fn(),
    onMaxConcurrentRunsChange: vi.fn(),
    onRegisterConcurrencyInput: vi.fn(),
    onRegisterVariableNameInput: vi.fn(),
    onRemoveTag: vi.fn(),
    onRemoveVariable: vi.fn(),
    onRenameVariable: vi.fn(),
    onRestoreVersion: vi.fn(),
    onRollbackTargetChange: vi.fn(),
    onRollbackVersion: vi.fn(),
    onTagInputChange: vi.fn(),
    onToggleTriggers: vi.fn(),
    onToggleVersions: vi.fn(),
    onVariableValueChange: vi.fn(),
  };
}

function renderMenu({ disabled = false, open = false } = {}) {
  const onOpenChange = vi.fn();
  render(
    <WorkflowSettingsMenu
      actions={actions()}
      disabled={disabled}
      editor={{
        autoSaveDisabled: false,
        autoSaveEnabled: true,
        isDirty: false,
        isLocked: false,
        selectedWorkflowId: "workflow-1",
      }}
      lifecycle={{
        isRollingBack: false,
        isTriggersLoading: false,
        isTriggersOpen: false,
        isVersionDiffLoading: false,
        isVersionsLoading: false,
        isVersionsOpen: false,
        publication: null,
        rollbackTargetVersion: null,
        triggers: [],
        triggersError: null,
        versionDiff: null,
        versionDiffError: null,
        versions: [],
        versionsError: null,
      }}
      nodeDisplayNames={{}}
      nodeTypes={[]}
      open={open}
      projectEnvironments={[]}
      tagInput=""
      workflow={{ ...createEmptyWorkflow(), id: "workflow-1", name: "接口回归" }}
      workflows={[]}
      onOpenChange={onOpenChange}
    />,
  );
  return onOpenChange;
}

describe("WorkflowSettingsMenu", () => {
  it("由触发按钮请求打开设置", () => {
    const onOpenChange = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "工作流设置" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("锁定时不允许打开设置", () => {
    const onOpenChange = renderMenu({ disabled: true });
    const trigger = screen.getByRole("button", { name: "工作流设置" });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("由弹层关闭命令统一请求关闭", () => {
    const onOpenChange = renderMenu({ open: true });
    fireEvent.click(screen.getByRole("button", { name: "关闭工作流设置" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
