import type { ReactNode, Ref } from "react";
import { Redo2, Search, SlidersHorizontal, Undo2 } from "lucide-react";
import type { WorkflowReleaseActionState } from "../lib/workflowRelease";
import type { WorkflowSaveActionState } from "../lib/saveState";
import type { WorkflowPublicationStatus } from "../types";

export type WorkflowTopbarIdentity = {
  activeScopeLabel: string | null;
  editorLocked: boolean;
  name: string;
  publication: WorkflowPublicationStatus | null;
  saveStatus: {
    className: string;
    hasConflict: boolean;
    label: string;
    title: string;
  };
  selectedWorkflowId: string;
  timeoutInputRef: Ref<HTMLInputElement>;
  timeoutMaximum: number;
  timeoutMinimum: number;
  timeoutSeconds: number;
};

export type WorkflowTopbarActions = {
  onCancelRun: () => void;
  onCreateWorkflow: () => void;
  onOpenCommandPalette: () => void;
  onOpenManualRun: () => void;
  onOpenSaveConflict: () => void;
  onPreviewNodeUpgrades: () => void;
  onRedo: () => void;
  onReturnToMain: () => void;
  onRunWorkflow: () => void;
  onSaveWorkflow: () => void;
  onToggleActivation: () => void;
  onUndo: () => void;
  onUpdateName: (name: string) => void;
  onUpdateTimeout: (value: string) => void;
  onValidateWorkflow: () => void;
};

export type WorkflowTopbarOperationState = {
  activation: WorkflowReleaseActionState;
  canCancelRun: boolean;
  canRedo: boolean;
  canUndo: boolean;
  isBusy: boolean;
  isCancelling: boolean;
  save: WorkflowSaveActionState;
  upgrade: WorkflowReleaseActionState;
};

type WorkflowTopbarProps = {
  actions: WorkflowTopbarActions;
  identity: WorkflowTopbarIdentity;
  operationState: WorkflowTopbarOperationState;
  resourceMenu: ReactNode;
  settingsMenu: ReactNode;
  workflowManager: ReactNode;
};

export function WorkflowTopbar({
  actions,
  identity,
  operationState,
  resourceMenu,
  settingsMenu,
  workflowManager,
}: WorkflowTopbarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-title">节点流</span>
        <input
          aria-label="工作流名称"
          className="workflow-name"
          disabled={identity.editorLocked}
          value={identity.name}
          onChange={(event) => actions.onUpdateName(event.currentTarget.value)}
        />
        {identity.saveStatus.hasConflict ? (
          <button
            aria-label="保存状态"
            className={`workflow-save-state ${identity.saveStatus.className}`}
            title="自动保存已暂停，点击处理版本冲突"
            type="button"
            onClick={actions.onOpenSaveConflict}
          >
            {identity.saveStatus.label}
          </button>
        ) : (
          <span
            aria-label="保存状态"
            className={`workflow-save-state ${identity.saveStatus.className}`}
            title={identity.saveStatus.title}
          >
            {identity.saveStatus.label}
          </span>
        )}
        {identity.selectedWorkflowId && identity.publication ? (
          <span
            aria-label="发布状态"
            className={`workflow-save-state ${publicationStatusClassName(identity.publication)}`}
          >
            {publicationStatusLabel(identity.publication)}
          </span>
        ) : null}
        <label className="workflow-timeout-field">
          <span>超时</span>
          <input
            aria-label="运行超时（秒）"
            disabled={identity.editorLocked}
            max={identity.timeoutMaximum}
            min={identity.timeoutMinimum}
            ref={identity.timeoutInputRef}
            type="number"
            value={identity.timeoutSeconds}
            onChange={(event) => actions.onUpdateTimeout(event.currentTarget.value)}
          />
          <span>秒</span>
        </label>
        <nav aria-label="编辑范围" className="breadcrumbs">
          <button disabled={!identity.activeScopeLabel} type="button" onClick={actions.onReturnToMain}>
            主流程
          </button>
          {identity.activeScopeLabel ? (
            <span className="breadcrumb-current">/ {identity.activeScopeLabel}</span>
          ) : null}
        </nav>
      </div>

      <div className="topbar-actions">
        <div aria-label="编辑历史" className="topbar-action-group topbar-history-group" role="group">
          <button
            aria-label="打开命令面板"
            className="icon-button"
            title="打开命令面板（Ctrl+K）"
            type="button"
            onClick={actions.onOpenCommandPalette}
          >
            <Search aria-hidden="true" size={16} strokeWidth={2.1} />
          </button>
          <button
            aria-label="撤销"
            className="icon-button"
            disabled={!operationState.canUndo}
            title="撤销（Ctrl+Z）"
            type="button"
            onClick={actions.onUndo}
          >
            <Undo2 aria-hidden="true" size={16} strokeWidth={2.1} />
          </button>
          <button
            aria-label="重做"
            className="icon-button"
            disabled={!operationState.canRedo}
            title="重做（Ctrl+Y 或 Ctrl+Shift+Z）"
            type="button"
            onClick={actions.onRedo}
          >
            <Redo2 aria-hidden="true" size={16} strokeWidth={2.1} />
          </button>
        </div>

        <div aria-label="工作区资源" className="topbar-action-group" role="group">
          {resourceMenu}
          {settingsMenu}
          {workflowManager}
        </div>

        <div aria-label="工作流命令" className="topbar-action-group" role="group">
          <button disabled={operationState.isBusy} type="button" onClick={actions.onCreateWorkflow}>新建</button>
          <button disabled={operationState.isBusy} type="button" onClick={actions.onValidateWorkflow}>验证</button>
          <button
            disabled={operationState.save.disabled}
            title={operationState.save.title}
            type="button"
            onClick={actions.onSaveWorkflow}
          >保存</button>
        </div>

        <div aria-label="发布管理" className="topbar-action-group" role="group">
          <button
            disabled={operationState.activation.disabled}
            title={operationState.activation.title}
            type="button"
            onClick={actions.onToggleActivation}
          >{operationState.activation.label}</button>
          <button
            disabled={operationState.upgrade.disabled}
            title={operationState.upgrade.title}
            type="button"
            onClick={actions.onPreviewNodeUpgrades}
          >{operationState.upgrade.label}</button>
        </div>

        <div aria-label="运行控制" className="topbar-action-group topbar-run-group" role="group">
          <button
            aria-label="设置本次运行输入"
            className="icon-button"
            disabled={operationState.isBusy}
            title="设置本次运行输入"
            type="button"
            onClick={actions.onOpenManualRun}
          >
            <SlidersHorizontal aria-hidden="true" size={16} strokeWidth={2} />
          </button>
          <button
            className="primary-button"
            disabled={operationState.isBusy}
            type="button"
            onClick={actions.onRunWorkflow}
          >运行</button>
          <button
            className="danger-button"
            disabled={!operationState.canCancelRun || operationState.isCancelling}
            type="button"
            onClick={actions.onCancelRun}
          >取消</button>
        </div>
      </div>
    </header>
  );
}

function publicationStatusClassName(publication: WorkflowPublicationStatus): "is-saved" | "is-dirty" {
  return publication.active && !publication.has_unpublished_changes ? "is-saved" : "is-dirty";
}

function publicationStatusLabel(publication: WorkflowPublicationStatus): string {
  if (!publication.active) {
    return `草稿 v${publication.draft_version} 未发布`;
  }
  if (publication.has_unpublished_changes) {
    return `生产 v${publication.published_version}，草稿 v${publication.draft_version}`;
  }
  return `已发布 v${publication.published_version}`;
}
