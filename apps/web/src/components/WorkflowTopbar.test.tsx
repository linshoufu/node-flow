import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowPublicationStatus } from "../types";
import {
  WorkflowTopbar,
  type WorkflowTopbarActions,
  type WorkflowTopbarIdentity,
  type WorkflowTopbarOperationState,
} from "./WorkflowTopbar";

afterEach(cleanup);

function actions(): WorkflowTopbarActions {
  return {
    onCancelRun: vi.fn(),
    onCreateWorkflow: vi.fn(),
    onOpenCommandPalette: vi.fn(),
    onOpenManualRun: vi.fn(),
    onOpenSaveConflict: vi.fn(),
    onPreviewNodeUpgrades: vi.fn(),
    onRedo: vi.fn(),
    onReturnToMain: vi.fn(),
    onRunWorkflow: vi.fn(),
    onSaveWorkflow: vi.fn(),
    onToggleActivation: vi.fn(),
    onUndo: vi.fn(),
    onUpdateName: vi.fn(),
    onUpdateTimeout: vi.fn(),
    onValidateWorkflow: vi.fn(),
  };
}

function identity(overrides: Partial<WorkflowTopbarIdentity> = {}): WorkflowTopbarIdentity {
  return {
    activeScopeLabel: null,
    editorLocked: false,
    name: "接口回归",
    publication: null,
    saveStatus: {
      className: "is-saved",
      hasConflict: false,
      label: "已保存",
      title: "工作流已保存",
    },
    selectedWorkflowId: "workflow-1",
    timeoutInputRef: null,
    timeoutMaximum: 3600,
    timeoutMinimum: 1,
    timeoutSeconds: 600,
    ...overrides,
  };
}

function operationState(
  overrides: Partial<WorkflowTopbarOperationState> = {},
): WorkflowTopbarOperationState {
  return {
    activation: { disabled: false, label: "发布工作流", title: "发布当前草稿" },
    canCancelRun: true,
    canRedo: true,
    canUndo: true,
    isBusy: false,
    isCancelling: false,
    save: { disabled: false, title: "保存工作流" },
    upgrade: { disabled: false, label: "检查节点升级", title: "检查升级" },
    ...overrides,
  };
}

function renderTopbar({
  actionSet = actions(),
  identityState = identity(),
  operation = operationState(),
}: {
  actionSet?: WorkflowTopbarActions;
  identityState?: WorkflowTopbarIdentity;
  operation?: WorkflowTopbarOperationState;
} = {}) {
  return render(
    <WorkflowTopbar
      actions={actionSet}
      identity={identityState}
      operationState={operation}
      resourceMenu={<button type="button">资源</button>}
      settingsMenu={<button type="button">设置</button>}
      workflowManager={<button type="button">工作流</button>}
    />,
  );
}

describe("WorkflowTopbar", () => {
  it("展示工作流身份并提交名称和超时修改", () => {
    const actionSet = actions();
    renderTopbar({ actionSet });

    fireEvent.change(screen.getByRole("textbox", { name: "工作流名称" }), {
      target: { value: "冒烟测试" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "运行超时（秒）" }), {
      target: { value: "90" },
    });

    expect(screen.getByLabelText("保存状态")).toHaveTextContent("已保存");
    expect(actionSet.onUpdateName).toHaveBeenCalledWith("冒烟测试");
    expect(actionSet.onUpdateTimeout).toHaveBeenCalledWith("90");
  });

  it("将冲突状态呈现为可处理命令", () => {
    const actionSet = actions();
    renderTopbar({
      actionSet,
      identityState: identity({
        saveStatus: {
          className: "is-conflict",
          hasConflict: true,
          label: "版本冲突",
          title: "存在版本冲突",
        },
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "保存状态" }));
    expect(actionSet.onOpenSaveConflict).toHaveBeenCalledOnce();
  });

  it("按可访问分组路由编辑、发布和运行命令", () => {
    const actionSet = actions();
    renderTopbar({ actionSet, identityState: identity({ activeScopeLabel: "循环体" }) });

    const history = screen.getByRole("group", { name: "编辑历史" });
    const workflowCommands = screen.getByRole("group", { name: "工作流命令" });
    const release = screen.getByRole("group", { name: "发布管理" });
    const run = screen.getByRole("group", { name: "运行控制" });
    fireEvent.click(within(history).getByRole("button", { name: "撤销" }));
    fireEvent.click(within(workflowCommands).getByRole("button", { name: "验证" }));
    fireEvent.click(within(release).getByRole("button", { name: "发布工作流" }));
    fireEvent.click(within(run).getByRole("button", { name: "运行" }));
    fireEvent.click(screen.getByRole("button", { name: "主流程" }));

    expect(actionSet.onUndo).toHaveBeenCalledOnce();
    expect(actionSet.onValidateWorkflow).toHaveBeenCalledOnce();
    expect(actionSet.onToggleActivation).toHaveBeenCalledOnce();
    expect(actionSet.onRunWorkflow).toHaveBeenCalledOnce();
    expect(actionSet.onReturnToMain).toHaveBeenCalledOnce();
  });

  it("根据运行状态禁用互斥命令", () => {
    renderTopbar({
      operation: operationState({
        activation: { disabled: true, label: "发布工作流", title: "正在处理" },
        canCancelRun: false,
        canRedo: false,
        canUndo: false,
        isBusy: true,
        save: { disabled: true, title: "正在处理" },
        upgrade: { disabled: true, label: "检查节点升级", title: "正在处理" },
      }),
    });

    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重做" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "运行" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  });

  it.each([
    [{ active: false, draft_version: 3, published_version: null }, "草稿 v3 未发布"],
    [{ active: true, draft_version: 4, published_version: 3 }, "生产 v3，草稿 v4"],
    [{ active: true, draft_version: 4, published_version: 4 }, "已发布 v4"],
  ])("展示中文发布状态 %#", (state, expectedLabel) => {
    const publication: WorkflowPublicationStatus = {
      workflow_id: "workflow-1",
      has_unpublished_changes: state.draft_version !== state.published_version,
      ...state,
    };
    renderTopbar({ identityState: identity({ publication }) });
    expect(screen.getByLabelText("发布状态")).toHaveTextContent(expectedLabel);
  });
});
