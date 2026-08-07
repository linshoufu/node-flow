import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkflow } from "../lib/workflow";
import type { ProjectEnvironment, WorkflowDocument, WorkflowSummary } from "../types";
import {
  WorkflowSettingsPopover,
  type WorkflowSettingsActions,
  type WorkflowSettingsEditorState,
  type WorkflowSettingsLifecycleState,
} from "./WorkflowSettingsPopover";

afterEach(cleanup);

function workflow(): WorkflowDocument {
  return {
    ...createEmptyWorkflow(),
    id: "workflow-1",
    name: "API regression",
    description: "Original description",
    tags: ["smoke"],
    version: 3,
    settings: {
      timeout_seconds: 600,
      variables: { token: "old", "bad-name": "invalid" },
      environment_id: "dev",
      error_workflow_id: "workflow-error",
      max_concurrent_runs: 2,
    },
  };
}

function actions(): WorkflowSettingsActions {
  return {
    onAddTag: vi.fn(),
    onAddVariable: vi.fn(),
    onAutoSaveChange: vi.fn(),
    onClose: vi.fn(),
    onCompareVersion: vi.fn(),
    onDescriptionChange: vi.fn(),
    onEnvironmentChange: vi.fn(),
    onErrorWorkflowChange: vi.fn(),
    onMaxConcurrentRunsChange: vi.fn(),
    onRegisterConcurrencyInput: vi.fn(),
    onRegisterTimeoutInput: vi.fn(),
    onRegisterVariableNameInput: vi.fn(),
    onRemoveTag: vi.fn(),
    onRemoveVariable: vi.fn(),
    onRenameVariable: vi.fn(),
    onRestoreVersion: vi.fn(),
    onRollbackTargetChange: vi.fn(),
    onRollbackVersion: vi.fn(),
    onTagInputChange: vi.fn(),
    onTimeoutChange: vi.fn(),
    onToggleTriggers: vi.fn(),
    onToggleVersions: vi.fn(),
    onVariableValueChange: vi.fn(),
  };
}

function editor(overrides: Partial<WorkflowSettingsEditorState> = {}): WorkflowSettingsEditorState {
  return {
    autoSaveDisabled: false,
    autoSaveEnabled: true,
    isDirty: false,
    isLocked: false,
    selectedWorkflowId: "workflow-1",
    ...overrides,
  };
}

function lifecycle(overrides: Partial<WorkflowSettingsLifecycleState> = {}): WorkflowSettingsLifecycleState {
  return {
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
    ...overrides,
  };
}

const environments: ProjectEnvironment[] = [
  {
    id: "dev",
    name: "开发",
    variables: {},
    is_default: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "staging",
    name: "预发布",
    variables: {},
    is_default: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

const workflows: WorkflowSummary[] = [
  { id: "workflow-1", name: "API regression", version: 3 },
  { id: "workflow-error", name: "错误通知", version: 1 },
];

function renderPopover({
  actionSet = actions(),
  editorState = editor(),
  lifecycleState = lifecycle(),
  withTrigger = false,
}: {
  actionSet?: WorkflowSettingsActions;
  editorState?: WorkflowSettingsEditorState;
  lifecycleState?: WorkflowSettingsLifecycleState;
  withTrigger?: boolean;
} = {}) {
  const popover = (
    <WorkflowSettingsPopover
      actions={actionSet}
      editor={editorState}
      lifecycle={lifecycleState}
      nodeDisplayNames={{}}
      nodeTypes={[]}
      projectEnvironments={environments}
      tagInput="new-tag"
      workflow={workflow()}
      workflows={workflows}
    />
  );
  render(withTrigger ? (
    <div className="workflow-settings">
      <button type="button">设置触发按钮</button>
      {popover}
    </div>
  ) : popover);
  return actionSet;
}

describe("WorkflowSettingsPopover", () => {
  it("routes metadata, tag, variable, environment, and runtime edits through its action contract", () => {
    const actionSet = renderPopover();

    fireEvent.change(screen.getByLabelText("工作流描述"), { target: { value: "Updated" } });
    fireEvent.keyDown(screen.getByLabelText("添加工作流标签"), { key: "Enter" });
    fireEvent.click(screen.getByLabelText("移除标签 smoke"));
    fireEvent.change(screen.getByLabelText("变量值 token"), { target: { value: "new-token" } });
    fireEvent.change(screen.getByLabelText("工作流默认环境"), { target: { value: "staging" } });
    fireEvent.change(screen.getByLabelText("运行超时（秒）"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("工作流同时运行上限"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("错误处理工作流"), { target: { value: "workflow-error" } });
    fireEvent.click(screen.getByLabelText("自动保存草稿"));

    expect(actionSet.onDescriptionChange).toHaveBeenCalledWith("Updated");
    expect(actionSet.onAddTag).toHaveBeenCalledTimes(1);
    expect(actionSet.onRemoveTag).toHaveBeenCalledWith("smoke");
    expect(actionSet.onVariableValueChange).toHaveBeenCalledWith("token", "new-token");
    expect(actionSet.onEnvironmentChange).toHaveBeenCalledWith("staging");
    expect(actionSet.onTimeoutChange).toHaveBeenCalledWith("45");
    expect(actionSet.onMaxConcurrentRunsChange).toHaveBeenCalledWith("4");
    expect(actionSet.onErrorWorkflowChange).toHaveBeenCalledWith("workflow-error");
    expect(actionSet.onAutoSaveChange).toHaveBeenCalledWith(false);
    expect(actionSet.onRegisterConcurrencyInput).toHaveBeenCalledWith(expect.any(HTMLInputElement));
    expect(actionSet.onRegisterTimeoutInput).toHaveBeenCalledWith(expect.any(HTMLInputElement));
    expect(screen.getByText("执行设置")).toBeInTheDocument();
    expect(screen.getByLabelText("变量名 bad-name")).toHaveAttribute("aria-invalid", "true");
  });

  it("closes from the icon, Escape, and an outside click", () => {
    const actionSet = renderPopover();

    fireEvent.click(screen.getByRole("button", { name: "关闭工作流设置" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.body);

    expect(actionSet.onClose).toHaveBeenCalledTimes(3);
  });

  it("leaves clicks on its owning trigger for the parent toggle to handle", () => {
    const actionSet = renderPopover({ withTrigger: true });

    fireEvent.mouseDown(screen.getByRole("button", { name: "设置触发按钮" }));

    expect(actionSet.onClose).not.toHaveBeenCalled();
  });

  it("shows trigger and version lifecycle state and dispatches eligible version actions", () => {
    const actionSet = renderPopover({
      lifecycleState: lifecycle({
        isTriggersOpen: true,
        isVersionsOpen: true,
        publication: {
          workflow_id: "workflow-1",
          draft_version: 3,
          published_version: 2,
          active: true,
          has_unpublished_changes: true,
        },
        rollbackTargetVersion: 1,
        versions: [
          { version: 1, created_at: "2026-01-01", name: "Initial", active: false, node_count: 2, action: "save", source_version: null },
          { version: 2, created_at: "2026-01-02", name: "Published", active: true, node_count: 3, action: "save", source_version: null },
          { version: 3, created_at: "2026-01-03", name: "Current", active: true, node_count: 4, action: "save", source_version: null },
        ],
      }),
    });

    expect(screen.getByText("当前工作流没有配置触发器")).toBeInTheDocument();
    const oldVersion = screen.getByText("v1").closest("li");
    expect(oldVersion).not.toBeNull();
    fireEvent.click(within(oldVersion as HTMLElement).getByRole("button", { name: "查看变更" }));
    fireEvent.click(within(oldVersion as HTMLElement).getByRole("button", { name: "恢复" }));
    fireEvent.click(within(oldVersion as HTMLElement).getByRole("button", { name: "回滚生产" }));
    fireEvent.click(screen.getByRole("button", { name: "确认回滚生产" }));

    expect(actionSet.onCompareVersion).toHaveBeenCalledWith(1);
    expect(actionSet.onRestoreVersion).toHaveBeenCalledWith(1);
    expect(actionSet.onRollbackTargetChange).toHaveBeenCalledWith(1);
    expect(actionSet.onRollbackVersion).toHaveBeenCalledWith(1);
    expect(within(screen.getByText("v3（当前）").closest("li") as HTMLElement).getByRole("button", { name: "恢复" })).toBeDisabled();
  });

  it("disables persisted lifecycle controls for an unsaved draft", () => {
    renderPopover({ editorState: editor({ isDirty: true, selectedWorkflowId: "" }) });

    expect(screen.getByRole("button", { name: "查看状态" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "查看历史" })).toBeDisabled();
  });
});
