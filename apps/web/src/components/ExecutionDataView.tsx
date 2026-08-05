import { useMemo, useState } from "react";
import type { ExecutionData, NodeExecution, NodeExecutionSummary } from "../lib/executionData";
import {
  buildExecutionDataView,
  type ExecutionDataPortDisplayNames,
  type ExecutionDataStatusFilter,
} from "../lib/executionDataView";
import { buildNodeRuntimeTarget } from "../lib/nodeRuntimeNavigation";
import { formatScope } from "../lib/runtimeDisplay";
import { portDisplayName } from "../lib/schemaDisplay";
import type { NodeType } from "../types";
import {
  ExecutionJsonBlock,
  formatDuration,
  formatValue,
  nodeDisplayName,
  nodeStatusLabels,
  type NodeSelectionTarget,
} from "./runPanelShared";

const executionStatusFilters: Array<{ id: ExecutionDataStatusFilter; label: string; name: string }> = [
  { id: "all", label: "全部状态", name: "全部" },
  { id: "succeeded", label: "成功状态", name: "成功" },
  { id: "failed", label: "失败状态", name: "失败" },
  { id: "running", label: "运行中状态", name: "运行中" },
  { id: "cancelled", label: "已取消状态", name: "已取消" },
];

export type ExecutionDataViewProps = {
  data: ExecutionData;
  nodeDisplayNames: Record<string, string>;
  nodeTypesByNodeId?: Record<string, NodeType>;
  statusFilter: ExecutionDataStatusFilter;
  onSelectNode?: (target: NodeSelectionTarget) => void;
  onStatusFilterChange: (status: ExecutionDataStatusFilter) => void;
};

export function ExecutionDataView({
  data,
  nodeDisplayNames,
  nodeTypesByNodeId = {},
  statusFilter,
  onSelectNode,
  onStatusFilterChange,
}: ExecutionDataViewProps) {
  const [query, setQuery] = useState("");
  const outputPortDisplayNamesByNodeId = useMemo(
    () => buildOutputPortDisplayNamesByNodeId(nodeTypesByNodeId),
    [nodeTypesByNodeId]
  );
  const view = useMemo(
    () => buildExecutionDataView(data, { query, status: statusFilter }, nodeDisplayNames, outputPortDisplayNamesByNodeId),
    [data, nodeDisplayNames, outputPortDisplayNamesByNodeId, query, statusFilter]
  );

  if (data.nodeOrder.length === 0) {
    return <p className="empty-state">还没有执行数据。</p>;
  }

  return (
    <div className="execution-data-view">
      <div className="execution-data-toolbar" aria-label="执行数据筛选">
        <label>
          <span>搜索执行数据</span>
          <input
            aria-label="搜索执行数据"
            placeholder="节点、状态、端口或数据"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="execution-status-filters" role="group" aria-label="执行状态筛选">
          {executionStatusFilters.map((filter) => (
            <button
              aria-label={filter.name}
              aria-pressed={statusFilter === filter.id}
              key={filter.id}
              type="button"
              onClick={() => onStatusFilterChange(filter.id)}
            >
              <span>{filter.label}</span>
              <em>{view.statusCounts[filter.id]}</em>
            </button>
          ))}
        </div>
      </div>

      {view.nodeIds.length === 0 ? <p className="empty-state">没有匹配的执行数据</p> : null}

      {view.nodeIds.map((nodeId) => (
        <section className="execution-node" key={nodeId}>
          <div className="execution-node-heading">
            <h3>{nodeDisplayName(nodeId, nodeDisplayNames)}</h3>
            <ExecutionNodeSummaryView summary={data.nodeSummaries[nodeId]} />
          </div>
          <div className="execution-run-list">
            {(data.nodeRuns[nodeId] ?? []).map((execution) => (
              <ExecutionRunCard
                execution={execution}
                key={`${nodeId}-${execution.runIndex}`}
                nodeDisplayNames={nodeDisplayNames}
                nodeType={nodeTypesByNodeId[execution.nodeId]}
                onSelectNode={onSelectNode}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ExecutionNodeSummaryView({ summary }: { summary: NodeExecutionSummary | undefined }) {
  if (!summary) {
    return null;
  }

  return (
    <div className="execution-node-summary" aria-label={`${summary.nodeId} 执行摘要`}>
      <span>{summary.runCount} 次运行</span>
      <span>{summary.inputItemCount} 项输入</span>
      <span>{summary.outputItemCount} 项输出</span>
      <span>{summary.outputConnectionCount} 个端口</span>
      {summary.errorCount > 0 ? <span>{summary.errorCount} 个错误</span> : null}
      <span>最近{nodeStatusLabels[summary.latestStatus]}</span>
    </div>
  );
}

type ExecutionRunCardProps = {
  execution: NodeExecution;
  nodeDisplayNames: Record<string, string>;
  nodeType?: NodeType;
  onSelectNode?: (target: NodeSelectionTarget) => void;
};

function ExecutionRunCard({ execution, nodeDisplayNames, nodeType, onSelectNode }: ExecutionRunCardProps) {
  const outputConnections = Object.values(execution.outputs);
  const scopeText = execution.scope.length > 0 ? formatScope(execution.scope) : "默认作用域";
  const displayName = nodeDisplayName(execution.nodeId, nodeDisplayNames);

  return (
    <article className="execution-run">
      <button
        aria-label={`查看执行数据 ${displayName} 第 ${execution.runIndex + 1} 次`}
        className="execution-run-header"
        type="button"
        onClick={() => onSelectNode?.(buildNodeRuntimeTarget(execution.nodeId, "execution_data", execution.scope))}
      >
        <strong>第 {execution.runIndex + 1} 次</strong>
        <span className={`execution-status status-${execution.status}`}>{nodeStatusLabels[execution.status]}</span>
        {execution.durationMs !== undefined ? <span>{formatDuration(execution.durationMs)}</span> : null}
        <em>{scopeText}</em>
      </button>
      <div className="execution-run-body">
        {execution.inputs !== undefined ? <ExecutionJsonBlock title="输入" value={execution.inputs} /> : null}
        {outputConnections.length > 0 ? (
          <div className="execution-ports" aria-label={`${execution.nodeId} 输出端口`}>
            {outputConnections.map((connection) => (
              <div className="execution-port" key={connection.name}>
                <strong>{outputPortDisplayName(connection.name, nodeType)}</strong>
                <span>{connection.items.length} 项</span>
                <code>{formatValue(connection.value)}</code>
              </div>
            ))}
          </div>
        ) : null}
        {execution.logs !== undefined ? <ExecutionJsonBlock title="日志" value={execution.logs} /> : null}
        {execution.error !== undefined ? <ExecutionJsonBlock title="错误" value={execution.error} /> : null}
      </div>
    </article>
  );
}

function buildOutputPortDisplayNamesByNodeId(
  nodeTypesByNodeId: Record<string, NodeType>
): ExecutionDataPortDisplayNames {
  return Object.fromEntries(
    Object.entries(nodeTypesByNodeId).map(([nodeId, nodeType]) => [
      nodeId,
      Object.fromEntries(
        Object.entries(nodeType.outputs).map(([name, port]) => [name, portDisplayName(name, port)])
      ),
    ])
  );
}

function outputPortDisplayName(connectionName: string, nodeType?: NodeType): string {
  const port = nodeType?.outputs[connectionName];
  return port ? portDisplayName(connectionName, port) : connectionName;
}
