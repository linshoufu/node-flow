import { useMemo, useState } from "react";
import type { NodeType, RunEvent, RunQueueStatus, RunRecord } from "../types";
import { translateRunExecutionMode, translateRunStatus } from "../lib/display";
import type { ExecutionDataStatusFilter } from "../lib/executionDataView";
import { buildRunInspector, type RunInspector, type RunInspectorExecutionSummary } from "../lib/runInspector";
import { buildRunComparison } from "../lib/runComparison";
import { buildNodeRuntimeTarget } from "../lib/nodeRuntimeNavigation";
import { ExecutionDataView } from "./ExecutionDataView";
import { FocusedNodeRunDetail } from "./FocusedNodeRunDetail";
import { RunComparisonView } from "./RunComparisonView";
import { RunEventList } from "./RunEventList";
import { TestReportView } from "./TestReportView";
import type { NodeSelectionTarget } from "./runPanelShared";

export type { NodeSelectionTarget } from "./runPanelShared";

type RunPanelProps = {
  run: RunRecord | null;
  queueStatus?: RunQueueStatus | null;
  events: RunEvent[];
  inspector?: RunInspector;
  isHistoricalRun?: boolean;
  nodeDisplayNames?: Record<string, string>;
  nodeTypesByNodeId?: Record<string, NodeType>;
  selectedNodeId?: string | null;
  onClearHistoricalRun?: () => void;
  onRetryHistoricalRun?: () => void;
  onOpenChildRun?: (runId: string) => void;
  onOpenParentRun?: (runId: string) => void;
  onSelectNode?: (target: NodeSelectionTarget) => void;
  comparisonRun?: RunRecord | null;
  comparisonEvents?: RunEvent[];
  comparisonRuns?: RunRecord[];
  comparisonLoading?: boolean;
  comparisonError?: string | null;
  onSelectComparisonRun?: (runId: string) => void;
};

type RunPanelTab = "report" | "data" | "events" | "comparison";

const coreRunPanelTabs: Array<{ id: RunPanelTab; label: string }> = [
  { id: "report", label: "测试报告" },
  { id: "data", label: "执行数据" },
  { id: "events", label: "运行事件" },
];

export function RunPanel({
  run,
  queueStatus = null,
  events,
  inspector: providedInspector,
  isHistoricalRun = false,
  nodeDisplayNames = {},
  nodeTypesByNodeId = {},
  selectedNodeId = null,
  onClearHistoricalRun,
  onRetryHistoricalRun,
  onOpenChildRun,
  onOpenParentRun,
  onSelectNode,
  comparisonRun = null,
  comparisonEvents = [],
  comparisonRuns = [],
  comparisonLoading = false,
  comparisonError = null,
  onSelectComparisonRun,
}: RunPanelProps) {
  const [activeTabState, setActiveTabState] = useState<{ runId: string; tab: RunPanelTab }>(() => ({
    runId: "",
    tab: "report",
  }));
  const [executionDataStatusFilterState, setExecutionDataStatusFilterState] = useState<{
    runId: string;
    status: ExecutionDataStatusFilter;
  }>(() => ({
    runId: "",
    status: "all",
  }));
  const inspector = useMemo(
    () => providedInspector ?? buildRunInspector({ run, events, isHistoricalRun, selectedNodeId }),
    [events, isHistoricalRun, providedInspector, run, selectedNodeId]
  );
  const { executionData, executionSummary, report, selectedNodeRunDetail } = inspector;
  const displayedRun = inspector.view.run;
  const displayedEvents = inspector.view.events;
  const displayedIsHistoricalRun = inspector.view.mode === "history";
  const displayedRunId = displayedRun?.id ?? "";
  const displayedQueueStatus =
    displayedRun?.status === "queued" && queueStatus?.run_id === displayedRun.id && queueStatus.state === "queued"
      ? queueStatus
      : null;
  const isWaitingForWorkflowSlot = Boolean(
    displayedQueueStatus &&
      displayedQueueStatus.workflow_active_count != null &&
      displayedQueueStatus.workflow_concurrency_limit != null &&
      displayedQueueStatus.workflow_active_count >= displayedQueueStatus.workflow_concurrency_limit
  );
  const canRetryHistoricalRun = Boolean(
    displayedRun &&
      displayedIsHistoricalRun &&
      !displayedRun.parent_run_id &&
      ["failed", "cancelled"].includes(displayedRun.status) &&
      ["manual", "schedule"].includes(displayedRun.execution_mode ?? "manual")
  );
  const comparison = useMemo(
    () => (comparisonRun && !comparisonLoading && !comparisonError ? buildRunComparison(comparisonEvents, displayedEvents) : null),
    [comparisonError, comparisonEvents, comparisonLoading, comparisonRun, displayedEvents]
  );
  const hasComparisonView = Boolean(comparisonRun || comparisonLoading || comparisonError);
  const runPanelTabs = hasComparisonView
    ? [...coreRunPanelTabs, { id: "comparison" as const, label: "运行对比" }]
    : coreRunPanelTabs;
  const requestedTab = activeTabState.runId === displayedRunId ? activeTabState.tab : "report";
  const activeTab = runPanelTabs.some((tab) => tab.id === requestedTab) ? requestedTab : "report";
  const setActiveTab = (tab: RunPanelTab) => setActiveTabState({ runId: displayedRunId, tab });
  const executionDataStatusFilter =
    executionDataStatusFilterState.runId === displayedRunId ? executionDataStatusFilterState.status : "all";
  const setExecutionDataStatusFilter = (status: ExecutionDataStatusFilter) =>
    setExecutionDataStatusFilterState({ runId: displayedRunId, status });
  const openExecutionData = (status: ExecutionDataStatusFilter = "all") => {
    setExecutionDataStatusFilter(status);
    setActiveTab("data");
  };
  const activeTabId = tabId(activeTab);
  const activePanelId = panelId(activeTab);
  const selectComparisonRun = (runId: string) => {
    if (!runId) {
      return;
    }
    setActiveTab("comparison");
    onSelectComparisonRun?.(runId);
  };

  return (
    <section className="run-panel" aria-label="运行结果">
      <div className="panel-heading">
        <div>
          <h2>运行结果</h2>
          <p>{displayedRun ? "查看本次运行的测试报告、执行数据和运行事件" : "查看测试报告和原始运行事件"}</p>
          {displayedRun ? (
            <div aria-label="运行来源" className="run-origin">
              <span>来源</span>
              <strong>{translateRunExecutionMode(displayedRun.execution_mode)}</strong>
            </div>
          ) : null}
          {executionSummary ? (
            <RunExecutionSummary summary={executionSummary} onOpenExecutionData={openExecutionData} onSelectTab={setActiveTab} />
          ) : null}
        </div>
        <span className={displayedRun ? `status-pill status-${displayedRun.status}` : "status-pill"}>
          {translateRunStatus(displayedRun?.status ?? "idle")}
        </span>
      </div>

      {displayedQueueStatus ? (
        <div className="run-queue-context" role="status">
          {isWaitingForWorkflowSlot
            ? `\u6b63\u5728\u7b49\u5f85\u6b64\u5de5\u4f5c\u6d41\u7a7a\u95f2\uff1a\u5f53\u524d ${displayedQueueStatus.workflow_active_count} / ${displayedQueueStatus.workflow_concurrency_limit} \u4e2a\u8fd0\u884c\u6267\u884c\u4e2d`
            : `\u6b63\u5728\u6392\u961f\uff1a\u7b2c ${displayedQueueStatus.position ?? 1} \u4f4d\uff0c\u5f53\u524d ${displayedQueueStatus.active_count} / ${displayedQueueStatus.concurrency_limit} \u4e2a\u8fd0\u884c\u6267\u884c\u4e2d`}
        </div>
      ) : null}

      {displayedRun && displayedIsHistoricalRun ? (
        <div className="run-history-context" role="note">
          <strong>历史运行</strong>
          <span>版本 v{displayedRun.workflow_version}</span>
          <span>创建 {formatRunCreatedAt(displayedRun.created_at)}</span>
          <span>{formatHistoricalRunDuration(displayedRun)}</span>
          {comparisonRuns.length > 0 ? (
            <label className="run-comparison-select">
              <span>运行对比</span>
              <select
                aria-label="选择对比运行"
                disabled={comparisonLoading}
                value={comparisonRun?.id ?? ""}
                onChange={(event) => selectComparisonRun(event.target.value)}
              >
                <option value="">选择一条历史运行</option>
                {comparisonRuns.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {formatRunCreatedAt(candidate.created_at)} · v{candidate.workflow_version} · {translateRunStatus(candidate.status)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canRetryHistoricalRun || onClearHistoricalRun ? (
            <div className="run-history-actions">
              {canRetryHistoricalRun && onRetryHistoricalRun ? (
                <button type="button" onClick={onRetryHistoricalRun}>
                  重新运行
                </button>
              ) : null}
              {onClearHistoricalRun ? (
                <button type="button" onClick={onClearHistoricalRun}>
                  清除历史视图
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {displayedRun?.parent_run_id ? (
        <div className="run-lineage-context" role="note">
        <span>{displayedRun.parent_node_id ? "由父运行中的节点触发" : "由父运行触发"}</span>
          {onOpenParentRun ? (
            <button type="button" onClick={() => onOpenParentRun(displayedRun.parent_run_id as string)}>
            查看父运行
            </button>
          ) : null}
        </div>
      ) : null}

      {selectedNodeRunDetail ? (
        <FocusedNodeRunDetail detail={selectedNodeRunDetail} nodeDisplayNames={nodeDisplayNames} onSelectNode={onSelectNode} />
      ) : null}

      <div className="run-panel-tabs" role="tablist" aria-label="运行面板视图">
        {runPanelTabs.map((tab) => (
          <button
            aria-controls={panelId(tab.id)}
            aria-selected={activeTab === tab.id}
            id={tabId(tab.id)}
            key={tab.id}
            role="tab"
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div aria-labelledby={activeTabId} className="run-panel-content" id={activePanelId} role="tabpanel">
        {activeTab === "report" ? (
          <TestReportView key={displayedRun?.id ?? "idle"} report={report} onSelectNode={onSelectNode} />
        ) : activeTab === "data" ? (
          <ExecutionDataView
            data={executionData}
            nodeDisplayNames={nodeDisplayNames}
            nodeTypesByNodeId={nodeTypesByNodeId}
            statusFilter={executionDataStatusFilter}
            onSelectNode={onSelectNode}
            onStatusFilterChange={setExecutionDataStatusFilter}
          />
        ) : activeTab === "events" ? (
          <RunEventList
            events={displayedEvents}
            nodeDisplayNames={nodeDisplayNames}
            onOpenChildRun={onOpenChildRun}
            onSelectNode={onSelectNode}
          />
        ) : comparisonLoading ? (
          <p className="empty-state">正在加载对比运行数据。</p>
        ) : comparisonError ? (
          <p className="empty-state">对比运行加载失败：{comparisonError}</p>
        ) : comparison ? (
          <RunComparisonView
            comparison={comparison}
            nodeDisplayNames={nodeDisplayNames}
            onSelectNode={(nodeId) => onSelectNode?.(buildNodeRuntimeTarget(nodeId, "run_comparison"))}
          />
        ) : (
          <p className="empty-state">选择另一条历史运行后查看节点差异。</p>
        )}
      </div>
    </section>
  );
}

function RunExecutionSummary({
  summary,
  onOpenExecutionData,
  onSelectTab,
}: {
  summary: RunInspectorExecutionSummary;
  onOpenExecutionData: (status?: ExecutionDataStatusFilter) => void;
  onSelectTab: (tab: RunPanelTab) => void;
}) {
  return (
    <div className="run-execution-summary" aria-label="运行执行摘要">
      <span>{summary.nodeCount} 个节点</span>
      <button type="button" onClick={() => onOpenExecutionData()}>
        {summary.executionCount} 次执行
      </button>
      <button type="button" onClick={() => onSelectTab("events")}>
        {summary.eventCount} 条事件
      </button>
      {summary.failedExecutionCount > 0 ? (
        <button className="is-warning" type="button" onClick={() => onOpenExecutionData("failed")}>
          {summary.failedExecutionCount} 次失败
        </button>
      ) : null}
      {summary.inputItemCount > 0 ? <span>{summary.inputItemCount} 项输入</span> : null}
      {summary.outputItemCount > 0 ? <span>{summary.outputItemCount} 项输出</span> : null}
    </div>
  );
}

function tabId(tab: RunPanelTab): string {
  return `run-panel-${tab}-tab`;
}

function panelId(tab: RunPanelTab): string {
  return `run-panel-${tab}-panel`;
}

function formatRunCreatedAt(value: string): string {
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

function formatHistoricalRunDuration(run: RunRecord): string {
  if (!run.started_at) {
    return "耗时未知";
  }
  if (!run.completed_at) {
    return "运行中";
  }

  const durationMs = new Date(run.completed_at).getTime() - new Date(run.started_at).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "耗时未知";
  }
  if (durationMs < 1000) {
    return `耗时 ${Math.round(durationMs)} ms`;
  }

  return `耗时 ${Math.round(durationMs / 1000)} 秒`;
}
