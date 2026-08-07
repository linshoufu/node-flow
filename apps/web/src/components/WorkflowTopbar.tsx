import type { ReactNode } from "react";
import { ActionIcon, Button, TextInput, Tooltip } from "@mantine/core";
import {
  CircleStop,
  Play,
  Plus,
  Redo2,
  Rocket,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Workflow,
} from "lucide-react";
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
  themeToggle?: ReactNode;
  workflowManager: ReactNode;
};

export function WorkflowTopbar({
  actions,
  identity,
  operationState,
  resourceMenu,
  settingsMenu,
  themeToggle,
  workflowManager,
}: WorkflowTopbarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span aria-hidden="true" className="brand-mark">
          <Workflow size={16} strokeWidth={2.2} />
        </span>
        <span className="brand-title">节点流</span>
        <TextInput
          aria-label="工作流名称"
          classNames={{ input: "workflow-name", root: "workflow-name-root" }}
          disabled={identity.editorLocked}
          size="sm"
          value={identity.name}
          onChange={(event) => actions.onUpdateName(event.currentTarget.value)}
        />
        {identity.saveStatus.hasConflict ? (
          <Button
            aria-label="保存状态"
            className={`workflow-save-state ${identity.saveStatus.className}`}
            size="compact-xs"
            title="自动保存已暂停，点击处理版本冲突"
            type="button"
            variant="subtle"
            onClick={actions.onOpenSaveConflict}
          >
            {identity.saveStatus.label}
          </Button>
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
        <nav aria-label="编辑范围" className="breadcrumbs">
          <Button disabled={!identity.activeScopeLabel} size="compact-xs" type="button" variant="subtle" onClick={actions.onReturnToMain}>
            主流程
          </Button>
          {identity.activeScopeLabel ? (
            <span className="breadcrumb-current">/ {identity.activeScopeLabel}</span>
          ) : null}
        </nav>
      </div>

      <div className="topbar-actions">
        <div aria-label="编辑历史" className="topbar-action-group topbar-history-group" role="group">
          <Tooltip label="命令面板 · Ctrl+K"><ActionIcon aria-label="打开命令面板" className="icon-button" size="lg" type="button" onClick={actions.onOpenCommandPalette}><Search aria-hidden="true" size={16} strokeWidth={2.1} /></ActionIcon></Tooltip>
          <Tooltip label="撤销 · Ctrl+Z"><ActionIcon aria-label="撤销" className="icon-button" disabled={!operationState.canUndo} size="lg" type="button" onClick={actions.onUndo}><Undo2 aria-hidden="true" size={16} strokeWidth={2.1} /></ActionIcon></Tooltip>
          <Tooltip label="重做 · Ctrl+Y"><ActionIcon aria-label="重做" className="icon-button" disabled={!operationState.canRedo} size="lg" type="button" onClick={actions.onRedo}><Redo2 aria-hidden="true" size={16} strokeWidth={2.1} /></ActionIcon></Tooltip>
          {themeToggle}
        </div>

        <div aria-label="工作区资源" className="topbar-action-group" role="group">
          {resourceMenu}
          {settingsMenu}
          {workflowManager}
        </div>

        <div aria-label="工作流命令" className="topbar-action-group" role="group">
          <Button disabled={operationState.isBusy} leftSection={<Plus size={14} />} size="compact-sm" type="button" variant="subtle" onClick={actions.onCreateWorkflow}>新建</Button>
          <Button disabled={operationState.isBusy} leftSection={<ShieldCheck size={14} />} size="compact-sm" type="button" variant="subtle" onClick={actions.onValidateWorkflow}>验证</Button>
          <Button
            disabled={operationState.save.disabled}
            leftSection={<Save size={14} />}
            size="compact-sm"
            title={operationState.save.title}
            type="button"
            variant="subtle"
            onClick={actions.onSaveWorkflow}
          >保存</Button>
        </div>

        <div aria-label="发布管理" className="topbar-action-group" role="group">
          <Button
            disabled={operationState.activation.disabled}
            leftSection={<Rocket size={14} />}
            size="compact-sm"
            title={operationState.activation.title}
            type="button"
            variant="subtle"
            onClick={actions.onToggleActivation}
          >{operationState.activation.label}</Button>
          <Button
            disabled={operationState.upgrade.disabled}
            leftSection={<Sparkles size={14} />}
            size="compact-sm"
            title={operationState.upgrade.title}
            type="button"
            variant="subtle"
            onClick={actions.onPreviewNodeUpgrades}
          >{operationState.upgrade.label}</Button>
        </div>

        <div aria-label="运行控制" className="topbar-action-group topbar-run-group" role="group">
          <Tooltip label="运行输入"><ActionIcon aria-label="设置本次运行输入" className="icon-button" disabled={operationState.isBusy} size="lg" type="button" onClick={actions.onOpenManualRun}><SlidersHorizontal aria-hidden="true" size={16} strokeWidth={2} /></ActionIcon></Tooltip>
          <Button
            className="primary-button"
            disabled={operationState.isBusy}
            leftSection={<Play size={14} fill="currentColor" />}
            size="compact-sm"
            type="button"
            onClick={actions.onRunWorkflow}
          >运行</Button>
          <Button
            className="danger-button"
            disabled={!operationState.canCancelRun || operationState.isCancelling}
            leftSection={<CircleStop size={14} />}
            size="compact-sm"
            type="button"
            variant="subtle"
            onClick={actions.onCancelRun}
          >取消</Button>
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
