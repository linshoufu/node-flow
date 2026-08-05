import type { NodeRunDetail } from "../lib/nodeRunDetail";
import { buildNodeRuntimeTarget } from "../lib/nodeRuntimeNavigation";
import { formatScope } from "../lib/runtimeDisplay";
import {
  ExecutionJsonBlock,
  formatDuration,
  formatValue,
  nodeDisplayName,
  nodeStatusLabels,
  type NodeSelectionTarget,
} from "./runPanelShared";

export type FocusedNodeRunDetailProps = {
  detail: NodeRunDetail;
  nodeDisplayNames: Record<string, string>;
  onSelectNode?: (target: NodeSelectionTarget) => void;
};

export function FocusedNodeRunDetail({ detail, nodeDisplayNames, onSelectNode }: FocusedNodeRunDetailProps) {
  const execution = detail.latestExecution;
  const outputConnections = execution ? Object.values(execution.outputs) : [];
  const displayName = nodeDisplayName(detail.nodeId, nodeDisplayNames);

  return (
    <section className="focused-node-run-detail" aria-label={`${displayName} 当前节点详情`}>
      <div className="focused-node-run-heading">
        <div>
          <h3>当前节点详情</h3>
          <strong>{displayName}</strong>
        </div>
        {detail.hasData ? <span>最近{nodeStatusLabels[detail.status]}</span> : <span>暂无数据</span>}
      </div>

      {!execution ? (
        <p>所选节点还没有运行数据。</p>
      ) : (
        <>
          <div className="focused-node-run-metrics">
            {detail.latestDurationMs !== undefined ? <span>耗时 {formatDuration(detail.latestDurationMs)}</span> : null}
            <span>输入 {detail.latestInputItemCount} 项</span>
            <span>输出 {detail.latestOutputItemCount} 项</span>
            <span>{detail.latestEventCount} 条事件</span>
            {detail.latestScope.length > 0 ? <span>{formatScope(detail.latestScope)}</span> : null}
          </div>
          <div className="focused-node-run-body">
            {execution.inputs !== undefined ? <ExecutionJsonBlock title="最新输入" value={execution.inputs} /> : null}
            {outputConnections.length > 0 ? (
              <div className="focused-node-run-ports" aria-label={`${detail.nodeId} 最新输出`}>
                {outputConnections.map((connection) => (
                  <div className="execution-port" key={connection.name}>
                    <strong>{connection.name}</strong>
                    <span>{connection.items.length} 项</span>
                    <code>{formatValue(connection.value)}</code>
                  </div>
                ))}
              </div>
            ) : null}
            {execution.error !== undefined ? <ExecutionJsonBlock title="错误" value={execution.error} /> : null}
          </div>
          {onSelectNode ? (
            <button type="button" onClick={() => onSelectNode(buildNodeRuntimeTarget(detail.nodeId, "focused_node", detail.latestScope))}>
              打开节点运行详情
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
