import { useEffect, useId, useMemo, useRef } from "react";
import { X } from "lucide-react";
import {
  workflowEnvironmentId,
  workflowErrorWorkflowId,
  workflowVariables,
} from "../lib/workflow";
import {
  MAX_WORKFLOW_CONCURRENT_RUNS,
  MIN_WORKFLOW_CONCURRENT_RUNS,
} from "../lib/workflowSettings";
import {
  buildWorkflowVariableIssues,
  formatWorkflowVariableValue,
} from "../lib/workflowVariables";
import type { WorkflowVersionDiff } from "../lib/workflowVersionDiff";
import type {
  NodeType,
  ProjectEnvironment,
  WorkflowDocument,
  WorkflowPublicationStatus,
  WorkflowSummary,
  WorkflowTriggerStatus,
  WorkflowVersionSummary,
} from "../types";
import { WorkflowTriggerStatusList } from "./WorkflowTriggerStatus";
import { WorkflowVersionDiffView } from "./WorkflowVersionDiffView";

export type WorkflowSettingsEditorState = {
  autoSaveDisabled: boolean;
  autoSaveEnabled: boolean;
  isDirty: boolean;
  isLocked: boolean;
  selectedWorkflowId: string;
};

export type WorkflowSettingsLifecycleState = {
  isRollingBack: boolean;
  isTriggersLoading: boolean;
  isTriggersOpen: boolean;
  isVersionDiffLoading: boolean;
  isVersionsLoading: boolean;
  isVersionsOpen: boolean;
  publication: WorkflowPublicationStatus | null;
  rollbackTargetVersion: number | null;
  triggers: WorkflowTriggerStatus[];
  triggersError: string | null;
  versionDiff: WorkflowVersionDiff | null;
  versionDiffError: string | null;
  versions: WorkflowVersionSummary[];
  versionsError: string | null;
};

export type WorkflowSettingsActions = {
  onAddTag: () => void;
  onAddVariable: () => void;
  onAutoSaveChange: (enabled: boolean) => void;
  onClose: () => void;
  onCompareVersion: (version: number) => void;
  onDescriptionChange: (description: string) => void;
  onEnvironmentChange: (environmentId: string) => void;
  onErrorWorkflowChange: (workflowId: string) => void;
  onMaxConcurrentRunsChange: (value: string) => void;
  onRegisterConcurrencyInput: (element: HTMLInputElement | null) => void;
  onRegisterVariableNameInput: (name: string, element: HTMLInputElement | null) => void;
  onRemoveTag: (tag: string) => void;
  onRemoveVariable: (name: string) => void;
  onRenameVariable: (previousName: string, nextName: string) => void;
  onRestoreVersion: (version: number) => void;
  onRollbackTargetChange: (version: number | null) => void;
  onRollbackVersion: (version: number) => void;
  onTagInputChange: (value: string) => void;
  onToggleTriggers: () => void;
  onToggleVersions: () => void;
  onVariableValueChange: (name: string, value: string) => void;
};

export type WorkflowSettingsPopoverProps = {
  actions: WorkflowSettingsActions;
  editor: WorkflowSettingsEditorState;
  lifecycle: WorkflowSettingsLifecycleState;
  nodeDisplayNames: Record<string, string>;
  nodeTypes: NodeType[];
  projectEnvironments: ProjectEnvironment[];
  tagInput: string;
  workflow: WorkflowDocument;
  workflows: WorkflowSummary[];
};

export function WorkflowSettingsPopover({
  actions,
  editor,
  lifecycle,
  nodeDisplayNames,
  nodeTypes,
  projectEnvironments,
  tagInput,
  workflow,
  workflows,
}: WorkflowSettingsPopoverProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(actions.onClose);
  const headingId = useId();
  const variableEntries = Object.entries(workflowVariables(workflow));
  const variableIssueByName = useMemo(
    () => new Map(buildWorkflowVariableIssues(workflowVariables(workflow)).map((issue) => [issue.name, issue.message])),
    [workflow],
  );
  onCloseRef.current = actions.onClose;

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      const settingsRoot = dialogRef.current?.parentElement;
      if (event.target instanceof Node && !settingsRoot?.contains(event.target)) {
        onCloseRef.current();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <section
      aria-labelledby={headingId}
      className="workflow-settings-popover"
      ref={dialogRef}
      role="dialog"
    >
      <div className="workflow-settings-popover-header">
        <strong id={headingId}>工作流设置</strong>
        <button
          aria-label="关闭工作流设置"
          className="icon-button"
          title="关闭"
          type="button"
          onClick={actions.onClose}
        >
          <X aria-hidden="true" size={17} strokeWidth={2} />
        </button>
      </div>

      <div className="workflow-settings-section">
        <div className="workflow-settings-section-heading"><strong>保存</strong></div>
        <label className="field-checkbox">
          <input
            aria-label="自动保存草稿"
            checked={editor.autoSaveEnabled}
            disabled={editor.autoSaveDisabled}
            type="checkbox"
            onChange={(event) => actions.onAutoSaveChange(event.currentTarget.checked)}
          />
          <span>自动保存草稿</span>
        </label>
      </div>

      <div className="workflow-settings-section">
        <div className="workflow-settings-section-heading"><strong>基本信息</strong></div>
        <label className="workflow-metadata-field">
          <span>描述</span>
          <textarea
            aria-label="工作流描述"
            disabled={editor.isLocked}
            placeholder="说明这个工作流解决什么问题"
            rows={3}
            value={workflow.description ?? ""}
            onChange={(event) => actions.onDescriptionChange(event.currentTarget.value)}
          />
        </label>
        <div className="workflow-tag-editor">
          <span>标签</span>
          <ul aria-label="工作流标签" className="workflow-tag-list">
            {(workflow.tags ?? []).map((tag) => (
              <li key={tag}>
                <span>{tag}</span>
                <button
                  aria-label={`移除标签 ${tag}`}
                  disabled={editor.isLocked}
                  type="button"
                  onClick={() => actions.onRemoveTag(tag)}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
          <div className="workflow-tag-input-row">
            <input
              aria-label="添加工作流标签"
              disabled={editor.isLocked}
              maxLength={40}
              placeholder="输入标签后按回车"
              value={tagInput}
              onChange={(event) => actions.onTagInputChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  actions.onAddTag();
                }
              }}
            />
            <button disabled={editor.isLocked || !tagInput.trim()} type="button" onClick={actions.onAddTag}>
              添加
            </button>
          </div>
        </div>
      </div>

      <div className="workflow-settings-section">
        <div className="workflow-settings-section-heading">
          <strong>变量</strong>
          <button disabled={editor.isLocked} type="button" onClick={actions.onAddVariable}>添加变量</button>
        </div>
        {variableEntries.length === 0 ? (
          <p className="workflow-variables-empty">暂无变量</p>
        ) : (
          <div className="workflow-variable-list">
            {variableEntries.map(([name, value]) => {
              const issueMessage = variableIssueByName.get(name);
              const errorId = issueMessage ? `workflow-variable-${safeDomId(name)}-error` : undefined;
              return (
                <div className="workflow-variable-row" key={name}>
                  <label>
                    <span>变量名</span>
                    <input
                      aria-describedby={errorId}
                      aria-invalid={issueMessage ? "true" : undefined}
                      aria-label={`变量名 ${name}`}
                      disabled={editor.isLocked}
                      ref={(element) => actions.onRegisterVariableNameInput(name, element)}
                      value={name}
                      onChange={(event) => actions.onRenameVariable(name, event.currentTarget.value)}
                    />
                    {issueMessage ? <small className="workflow-variable-error" id={errorId}>{issueMessage}</small> : null}
                  </label>
                  <label>
                    <span>变量值</span>
                    <input
                      aria-label={`变量值 ${name}`}
                      disabled={editor.isLocked}
                      value={formatWorkflowVariableValue(value)}
                      onChange={(event) => actions.onVariableValueChange(name, event.currentTarget.value)}
                    />
                  </label>
                  <button disabled={editor.isLocked} type="button" onClick={() => actions.onRemoveVariable(name)}>删除</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="workflow-settings-section">
        <div className="workflow-settings-section-heading"><strong>运行环境</strong></div>
        <label className="workflow-error-workflow-field">
          <span>默认环境</span>
          <select
            aria-label="工作流默认环境"
            disabled={editor.isLocked || projectEnvironments.length === 0}
            value={workflowEnvironmentId(workflow)}
            onChange={(event) => actions.onEnvironmentChange(event.currentTarget.value)}
          >
            {projectEnvironments.map((environment) => (
              <option key={environment.id} value={environment.id}>{environment.name}</option>
            ))}
          </select>
        </label>
        <p className="workflow-settings-hint">保存后作为手动运行、定时触发和生产 Webhook 的默认非敏感配置来源。</p>
      </div>

      <div className="workflow-settings-section">
        <div className="workflow-settings-section-heading"><strong>运行并发</strong></div>
        <label className="workflow-error-workflow-field">
          <span>同时运行上限</span>
          <input
            aria-label="工作流同时运行上限"
            disabled={editor.isLocked}
            max={MAX_WORKFLOW_CONCURRENT_RUNS}
            min={MIN_WORKFLOW_CONCURRENT_RUNS}
            placeholder="不限制"
            ref={actions.onRegisterConcurrencyInput}
            type="number"
            value={workflow.settings?.max_concurrent_runs ?? ""}
            onChange={(event) => actions.onMaxConcurrentRunsChange(event.currentTarget.value)}
          />
        </label>
        <p className="workflow-settings-hint">留空时只受全局队列限制；设为 1 可让同一工作流串行运行。</p>
      </div>

      <div className="workflow-settings-section">
        <div className="workflow-settings-section-heading"><strong>错误处理</strong></div>
        <label className="workflow-error-workflow-field">
          <span>错误工作流</span>
          <select
            aria-label="错误处理工作流"
            disabled={editor.isLocked}
            value={workflowErrorWorkflowId(workflow) ?? ""}
            onChange={(event) => actions.onErrorWorkflowChange(event.currentTarget.value)}
          >
            <option value="">不执行错误处理工作流</option>
            {workflows.filter((candidate) => candidate.id !== workflow.id).map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.name.trim() || "未命名工作流"}</option>
            ))}
          </select>
        </label>
        <p className="workflow-settings-hint">失败时会把运行上下文交给所选工作流；该工作流应以“工作流触发”开始。</p>
      </div>

      <div className="workflow-settings-section workflow-version-history">
        <div className="workflow-settings-section-heading">
          <strong>触发器状态</strong>
          <button
            disabled={!editor.selectedWorkflowId || editor.isDirty}
            title={!editor.selectedWorkflowId ? "请先保存工作流" : editor.isDirty ? "请先保存当前修改" : "查看已保存工作流的触发器状态"}
            type="button"
            onClick={actions.onToggleTriggers}
          >
            {lifecycle.isTriggersOpen ? "收起状态" : "查看状态"}
          </button>
        </div>
        {lifecycle.isTriggersOpen ? (
          <>
            {lifecycle.triggersError ? <p className="workflow-version-history-error">{lifecycle.triggersError}</p> : null}
            {lifecycle.isTriggersLoading ? <p className="workflow-variables-empty">正在加载触发器状态</p> : null}
            {!lifecycle.isTriggersLoading && !lifecycle.triggersError ? (
              <WorkflowTriggerStatusList nodeTypes={nodeTypes} triggers={lifecycle.triggers} />
            ) : null}
          </>
        ) : null}
      </div>

      <div className="workflow-settings-section workflow-version-history">
        <div className="workflow-settings-section-heading">
          <strong>版本历史</strong>
          <button disabled={editor.isLocked || !editor.selectedWorkflowId} type="button" onClick={actions.onToggleVersions}>
            {lifecycle.isVersionsOpen ? "收起历史" : "查看历史"}
          </button>
        </div>
        {lifecycle.isVersionsOpen ? (
          <>
            {lifecycle.versionsError ? <p className="workflow-version-history-error">{lifecycle.versionsError}</p> : null}
            {lifecycle.isVersionsLoading ? <p className="workflow-variables-empty">正在加载版本历史</p> : null}
            {!lifecycle.isVersionsLoading && !lifecycle.versionsError && lifecycle.versions.length === 0 ? (
              <p className="workflow-variables-empty">暂无历史版本</p>
            ) : null}
            {!lifecycle.isVersionsLoading && lifecycle.versions.length > 0 ? (
              <ul aria-label="工作流版本历史" className="workflow-version-history-list">
                {lifecycle.versions.map((item) => {
                  const isCurrent = item.version === workflow.version;
                  const isPublished = item.version === lifecycle.publication?.published_version;
                  const canRollback = Boolean(lifecycle.publication?.active) && !isCurrent && !isPublished;
                  return (
                    <li key={item.version}>
                      <div>
                        <strong>v{item.version}{isCurrent ? "（当前）" : ""}{isPublished ? "（生产）" : ""}</strong>
                        <span>{item.name}</span>
                        <small>{item.node_count} 个节点 · {workflowVersionActionLabel(item)}</small>
                      </div>
                      <div className="workflow-version-history-actions">
                        <button
                          disabled={editor.isLocked || editor.isDirty || isCurrent}
                          title={isCurrent ? "当前正在使用该版本" : editor.isDirty ? "请先保存当前修改" : "查看该版本与当前版本的差异"}
                          type="button"
                          onClick={() => actions.onCompareVersion(item.version)}
                        >查看变更</button>
                        <button
                          disabled={editor.isLocked || editor.isDirty || isCurrent}
                          title={isCurrent ? "当前正在使用该版本" : editor.isDirty ? "请先保存当前修改" : "恢复此版本并创建新的当前版本"}
                          type="button"
                          onClick={() => actions.onRestoreVersion(item.version)}
                        >恢复</button>
                        <button
                          disabled={editor.isLocked || editor.isDirty || !canRollback || lifecycle.isRollingBack}
                          title={!lifecycle.publication?.active ? "当前没有生产版本" : isCurrent ? "当前正在使用该版本" : isPublished ? "该版本已经在生产环境运行" : editor.isDirty ? "请先保存当前修改" : "创建新版本并立即切换生产工作流"}
                          type="button"
                          onClick={() => actions.onRollbackTargetChange(item.version)}
                        >回滚生产</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {lifecycle.rollbackTargetVersion !== null ? (
              <section aria-label="确认回滚生产版本" aria-modal="true" className="workflow-rollback-confirmation" role="alertdialog">
                <h3>回滚生产版本</h3>
                <p>将立即把生产触发器切换到 v{lifecycle.rollbackTargetVersion} 的内容，并创建新的已发布版本。</p>
                <p>当前草稿和历史版本都会保留，不会被覆盖。</p>
                <div className="workflow-rollback-confirmation-actions">
                  <button disabled={lifecycle.isRollingBack} type="button" onClick={() => actions.onRollbackTargetChange(null)}>取消</button>
                  <button
                    className="workflow-rollback-confirm"
                    disabled={lifecycle.isRollingBack}
                    type="button"
                    onClick={() => actions.onRollbackVersion(lifecycle.rollbackTargetVersion as number)}
                  >{lifecycle.isRollingBack ? "正在回滚" : "确认回滚生产"}</button>
                </div>
              </section>
            ) : null}
            {lifecycle.isVersionDiffLoading ? <p className="workflow-variables-empty">正在加载版本差异</p> : null}
            {lifecycle.versionDiffError ? <p className="workflow-version-history-error">{lifecycle.versionDiffError}</p> : null}
            {lifecycle.versionDiff ? <WorkflowVersionDiffView diff={lifecycle.versionDiff} nodeDisplayNames={nodeDisplayNames} /> : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function safeDomId(value: string): string {
  const id = value.replace(/[^A-Za-z0-9_-]+/g, "-");
  return id || "empty";
}

function workflowVersionActionLabel(version: WorkflowVersionSummary): string {
  if (version.action === "rollback" && version.source_version !== null) {
    return `生产回滚自 v${version.source_version}`;
  }
  if (version.action === "restore" && version.source_version !== null) {
    return `恢复自 v${version.source_version}`;
  }
  return version.active ? "已发布" : "普通保存";
}
