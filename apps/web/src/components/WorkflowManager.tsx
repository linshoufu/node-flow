import { useMemo, useRef, useState } from "react";
import {
  buildWorkflowManagerItems,
  sortWorkflowRunsByRecent,
  workflowStatusFilterCounts,
  type WorkflowManagerSortMode,
  type WorkflowManagerStatusFilter,
} from "../lib/workflowManager";
import type { WorkflowSaveActionState } from "../lib/saveState";
import type { RunHistoryStatusFilter, RunRecord, RunStatus, WorkflowSummary } from "../types";
import { translateRunExecutionMode } from "../lib/display";

type WorkflowManagerProps = {
  currentWorkflowName?: string;
  disabled: boolean;
  isCurrentWorkflowDirty?: boolean;
  saveActionState?: WorkflowSaveActionState;
  selectedWorkflowId: string;
  workflows: WorkflowSummary[];
  selectedWorkflowRuns?: RunRecord[];
  hasMoreRunHistory?: boolean;
  runHistoryStatus?: RunHistoryStatusFilter;
  runHistoryError?: string | null;
  runHistoryLoading?: boolean;
  onCreateWorkflow: () => void;
  onDeleteWorkflow?: (workflowId: string) => Promise<void>;
  onDuplicateWorkflow: (workflowId: string) => void;
  onExportWorkflow?: () => void;
  onImportWorkflow?: (file: File) => void;
  onLoadWorkflow: (workflowId: string) => void;
  onOpenRun?: (runId: string) => void;
  onLoadMoreRunHistory?: () => void;
  onRunHistoryStatusChange?: (status: RunHistoryStatusFilter) => void;
  onReloadRunHistory?: () => void;
  onSaveWorkflow: () => void;
  onValidateWorkflow: () => void;
};

export function WorkflowManager({
  currentWorkflowName,
  disabled,
  isCurrentWorkflowDirty = false,
  saveActionState = { disabled: false, title: "保存当前工作流" },
  selectedWorkflowId,
  workflows,
  selectedWorkflowRuns = [],
  hasMoreRunHistory = false,
  runHistoryStatus = "all",
  runHistoryError = null,
  runHistoryLoading = false,
  onCreateWorkflow,
  onDeleteWorkflow,
  onDuplicateWorkflow,
  onExportWorkflow,
  onImportWorkflow,
  onLoadWorkflow,
  onOpenRun,
  onLoadMoreRunHistory,
  onRunHistoryStatusChange,
  onReloadRunHistory,
  onSaveWorkflow,
  onValidateWorkflow,
}: WorkflowManagerProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorkflowManagerStatusFilter>("all");
  const [sortMode, setSortMode] = useState<WorkflowManagerSortMode>("updated_desc");
  const [deleteTarget, setDeleteTarget] = useState<WorkflowSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const statusCounts = useMemo(() => workflowStatusFilterCounts(workflows), [workflows]);
  const recentRuns = useMemo(() => sortWorkflowRunsByRecent(selectedWorkflowRuns), [selectedWorkflowRuns]);
  const items = useMemo(
    () => buildWorkflowManagerItems(workflows, selectedWorkflowId, query, { status: statusFilter, sort: sortMode }),
    [query, selectedWorkflowId, sortMode, statusFilter, workflows]
  );
  const triggerLabel = currentWorkflowName
    ? `${currentWorkflowName}，工作流 ${workflows.length}`
    : `工作流 ${workflows.length}`;

  function runPanelAction(action: () => void) {
    action();
    setIsOpen(false);
  }

  function selectImportFile(file: File | undefined) {
    if (!file || !onImportWorkflow) {
      return;
    }

    onImportWorkflow(file);
    setIsOpen(false);
  }

  async function deleteSelectedWorkflow() {
    if (!deleteTarget || !onDeleteWorkflow || isDeleting) {
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteWorkflow(deleteTarget.id);
      setDeleteTarget(null);
      setIsOpen(false);
    } catch (error) {
      setDeleteError(formatDeletionError(error));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="workflow-manager">
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="workflow-manager-trigger"
        type="button"
        onClick={() => setIsOpen((current) => !current)}
      >
        {triggerLabel}
      </button>

      {isOpen ? (
        <section aria-label="工作流管理" className="workflow-manager-popover" role="dialog">
          <div className="workflow-manager-header">
            <div>
              <h2>工作流管理</h2>
              <span>{workflows.length} 个已保存</span>
            </div>
            <button aria-label="关闭工作流管理" type="button" onClick={() => setIsOpen(false)}>
              关闭
            </button>
          </div>

          <div className="workflow-manager-actions">
            <button disabled={disabled} type="button" onClick={() => runPanelAction(onCreateWorkflow)}>
              新建工作流
            </button>
            <button
              disabled={disabled || saveActionState.disabled}
              title={disabled ? "正在处理，请稍候" : saveActionState.title}
              type="button"
              onClick={() => runPanelAction(onSaveWorkflow)}
            >
              保存当前
            </button>
            <button disabled={disabled} type="button" onClick={() => runPanelAction(onValidateWorkflow)}>
              验证当前
            </button>
            {onImportWorkflow ? (
              <button disabled={disabled} type="button" onClick={() => importInputRef.current?.click()}>
                导入 JSON
              </button>
            ) : null}
            {onExportWorkflow ? (
              <button disabled={disabled} type="button" onClick={() => runPanelAction(onExportWorkflow)}>
                导出当前工作流
              </button>
            ) : null}
          </div>

          {onImportWorkflow ? (
            <input
              ref={importInputRef}
              aria-label="选择工作流 JSON 文件"
              accept="application/json,.json"
              hidden
              type="file"
              onChange={(event) => {
                selectImportFile(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          ) : null}

          <input
            aria-label="搜索工作流"
            className="workflow-manager-search"
            placeholder="搜索名称或 ID"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />

          <div className="workflow-manager-controls">
            <div aria-label="工作流状态筛选" className="workflow-manager-status-filters" role="group">
              <button
                aria-pressed={statusFilter === "all"}
                type="button"
                onClick={() => setStatusFilter("all")}
              >
                全部 {statusCounts.all}
              </button>
              <button
                aria-pressed={statusFilter === "failed"}
                type="button"
                onClick={() => setStatusFilter("failed")}
              >
                失败 {statusCounts.failed}
              </button>
              <button
                aria-pressed={statusFilter === "succeeded"}
                type="button"
                onClick={() => setStatusFilter("succeeded")}
              >
                成功 {statusCounts.succeeded}
              </button>
              <button
                aria-pressed={statusFilter === "cancelled"}
                type="button"
                onClick={() => setStatusFilter("cancelled")}
              >
                已取消 {statusCounts.cancelled}
              </button>
              <button
                aria-pressed={statusFilter === "running"}
                type="button"
                onClick={() => setStatusFilter("running")}
              >
                运行中 {statusCounts.running}
              </button>
              <button
                aria-pressed={statusFilter === "not_run"}
                type="button"
                onClick={() => setStatusFilter("not_run")}
              >
                未运行 {statusCounts.not_run}
              </button>
            </div>
            <label className="workflow-manager-sort">
              <span>排序</span>
              <select
                aria-label="工作流排序"
                value={sortMode}
                onChange={(event) => setSortMode(event.currentTarget.value as WorkflowManagerSortMode)}
              >
                <option value="updated_desc">最近更新</option>
                <option value="name_asc">名称</option>
                <option value="node_count_desc">节点最多</option>
              </select>
            </label>
          </div>

          {selectedWorkflowId ? (
            <section aria-label="当前工作流最近运行" className="workflow-manager-run-history">
              <div className="workflow-manager-run-history-header">
                <h3>当前工作流最近运行</h3>
                <div className="workflow-manager-run-history-actions">
                  <span>{runHistoryLoading ? "正在加载" : `${recentRuns.length} 条`}</span>
                  {onReloadRunHistory ? (
                    <button
                      aria-label="刷新运行历史"
                      disabled={runHistoryLoading}
                      type="button"
                      onClick={onReloadRunHistory}
                    >
                      刷新
                    </button>
                  ) : null}
                </div>
              </div>
              {onRunHistoryStatusChange ? (
                <div aria-label="运行历史状态筛选" className="workflow-manager-run-history-filters" role="group">
                  {runHistoryStatusFilters.map((filter) => (
                    <button
                      aria-label={`筛选${filter.label}运行`}
                      aria-pressed={runHistoryStatus === filter.status}
                      key={filter.status}
                      type="button"
                      onClick={() => onRunHistoryStatusChange(filter.status)}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {runHistoryError ? (
                <div className="workflow-manager-run-history-error" role="alert">
                  <span>{runHistoryError}</span>
                  {onReloadRunHistory ? (
                    <button
                      aria-label="重试运行历史加载"
                      disabled={runHistoryLoading}
                      type="button"
                      onClick={onReloadRunHistory}
                    >
                      重试
                    </button>
                  ) : null}
                </div>
              ) : null}
              {recentRuns.length > 0 ? (
                <>
                  <ul>
                    {recentRuns.map((historyRun, index) => (
                    <li key={historyRun.id}>
                      <div className="workflow-manager-run-row-main">
                        <strong>{translateRunExecutionMode(historyRun.execution_mode)} · 运行记录 {index + 1}</strong>
                        <span className={`workflow-manager-status ${historyRun.status}`}>
                          {runStatusLabel(historyRun.status)}
                        </span>
                      </div>
                      <div className="workflow-manager-run-row-detail">
                        <small>{formatRunMetadata(historyRun)}</small>
                        {onOpenRun ? (
                          <button
                            type="button"
                            aria-label={`查看第 ${index + 1} 次运行日志`}
                            onClick={() => runPanelAction(() => onOpenRun(historyRun.id))}
                          >
                            查看日志
                          </button>
                        ) : null}
                      </div>
                      {historyRun.error ? <p>{historyRun.error}</p> : null}
                    </li>
                    ))}
                  </ul>
                  {hasMoreRunHistory && onLoadMoreRunHistory ? (
                    <div className="workflow-manager-run-history-more">
                      <button
                        aria-label="加载更多运行记录"
                        disabled={runHistoryLoading}
                        type="button"
                        onClick={onLoadMoreRunHistory}
                      >
                        {runHistoryLoading ? "正在加载更多" : "加载更多"}
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="workflow-manager-run-history-empty">
                  {runHistoryError ? "请稍后重试" : runHistoryLoading ? "正在加载运行记录" : "暂无运行记录"}
                </div>
              )}
            </section>
          ) : null}
          {items.length > 0 ? (
            <ul className="workflow-manager-list">
              {items.map((item) => (
                <li
                  aria-current={item.isActive ? "page" : undefined}
                  className={item.isActive ? "workflow-manager-item active" : "workflow-manager-item"}
                  key={item.workflow.id}
                >
                  <div className="workflow-manager-item-main">
                    <div className="workflow-manager-item-title">
                      <strong>{item.title}</strong>
                      <span className={`workflow-manager-activation ${item.workflow.active ?? true ? "active" : "inactive"}`}>
                        {item.workflow.active ?? true ? "已启用" : "已停用"}
                      </span>
                      <span className={`workflow-manager-status ${item.statusKind}`}>{item.statusLabel}</span>
                    </div>
                    <span>{item.subtitle}</span>
                    {item.workflow.description?.trim() ? (
                      <p className="workflow-manager-item-description">{item.workflow.description.trim()}</p>
                    ) : null}
                    {item.workflow.tags?.length ? (
                      <div aria-label={`${item.title}的标签`} className="workflow-manager-item-tags">
                        {item.workflow.tags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    ) : null}
                    <small>{item.metadata}</small>
                  </div>
                  <div className="workflow-manager-item-actions">
                    <button
                      disabled={disabled}
                      type="button"
                      aria-label={`打开 ${item.title}`}
                      onClick={() => runPanelAction(() => onLoadWorkflow(item.workflow.id))}
                    >
                      打开
                    </button>
                    <button
                      disabled={disabled}
                      type="button"
                      aria-label={`复制 ${item.title}`}
                      onClick={() => runPanelAction(() => onDuplicateWorkflow(item.workflow.id))}
                    >
                      复制
                    </button>
                    {onDeleteWorkflow ? (
                      <button
                        aria-label={`删除 ${item.title}`}
                        className="workflow-manager-delete-action"
                        disabled={disabled || isDeleting}
                        type="button"
                        onClick={() => {
                          setDeleteTarget(item.workflow);
                          setDeleteError(null);
                        }}
                      >
                        删除
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="workflow-manager-empty">{workflows.length === 0 ? "还没有保存的工作流" : "没有匹配的工作流"}</div>
          )}
          {deleteTarget ? (
            <section aria-label="删除工作流" aria-modal="true" className="workflow-delete-confirmation" role="alertdialog">
              <h3>删除工作流</h3>
              <p>会永久删除此工作流的所有版本和运行记录，且无法恢复。</p>
              {deleteTarget.id === selectedWorkflowId && isCurrentWorkflowDirty ? (
                <p className="workflow-delete-warning">当前画布还有未保存修改，也会一并丢弃。</p>
              ) : null}
              <p>仍被其他工作流调用，或仍有运行中的任务时，系统会阻止删除。</p>
              {deleteError ? <p className="workflow-delete-error" role="alert">{deleteError}</p> : null}
              <div className="workflow-delete-confirmation-actions">
                <button disabled={isDeleting} type="button" onClick={() => setDeleteTarget(null)}>
                  取消
                </button>
                <button className="danger-button" disabled={isDeleting} type="button" onClick={() => void deleteSelectedWorkflow()}>
                  {isDeleting ? "正在删除" : "永久删除"}
                </button>
              </div>
            </section>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

const runHistoryStatusFilters: Array<{ status: RunHistoryStatusFilter; label: string }> = [
  { status: "all", label: "全部" },
  { status: "queued", label: "排队中" },
  { status: "running", label: "运行中" },
  { status: "succeeded", label: "成功" },
  { status: "failed", label: "失败" },
  { status: "cancelled", label: "已取消" },
];


function formatDeletionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const apiBody = message.replace(/^API\s+\d+:\s*/, "");
  try {
    const parsed = JSON.parse(apiBody) as { detail?: { message?: unknown } };
    if (typeof parsed.detail?.message === "string") {
      return parsed.detail.message;
    }
  } catch {
    // Use the original message when the API response is not structured JSON.
  }
  return message;
}

function runStatusLabel(status: RunStatus): string {
  switch (status) {
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "running":
      return "运行中";
    case "queued":
      return "排队中";
  }
}

function formatRunMetadata(run: RunRecord): string {
  return `v${run.workflow_version} · ${formatDateTime(run.created_at)} · ${formatDuration(run)}`;
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return "时间未知";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

function formatDuration(run: RunRecord): string {
  if (!run.started_at || !run.completed_at) {
    return run.status === "running" ? "运行中" : "耗时未知";
  }
  const startedAt = new Date(run.started_at).getTime();
  const completedAt = new Date(run.completed_at).getTime();
  if (Number.isNaN(startedAt) || Number.isNaN(completedAt) || completedAt < startedAt) {
    return "耗时未知";
  }
  const seconds = Math.max(1, Math.round((completedAt - startedAt) / 1000));
  return `${seconds} 秒`;
}

// default 导出适配：供 React.lazy 懒加载使用，不改变组件内部逻辑
export default WorkflowManager;
