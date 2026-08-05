import type { RunComparison, RunComparisonNode } from "../lib/runComparison";
import { nodeDisplayName, nodeStatusLabels } from "./runPanelShared";

type RunComparisonViewProps = {
  comparison: RunComparison;
  nodeDisplayNames: Record<string, string>;
  onSelectNode?: (nodeId: string) => void;
};

export function RunComparisonView({ comparison, nodeDisplayNames, onSelectNode }: RunComparisonViewProps) {
  if (comparison.nodeCount === 0) {
    return <p className="empty-state">两次运行都没有节点执行数据。</p>;
  }

  return (
    <div className="run-comparison-view">
      <div className="run-comparison-summary" aria-label="运行对比摘要">
        <strong>{comparison.changedNodeCount} 个节点有变化</strong>
        <span>{comparison.unchangedNodeCount} 个节点未变化</span>
      </div>
      <div className="run-comparison-list">
        {comparison.nodes.map((node) => (
          <ComparisonNodeRow
            key={node.nodeId}
            node={node}
            nodeDisplayName={nodeDisplayName(node.nodeId, nodeDisplayNames)}
            onSelectNode={onSelectNode}
          />
        ))}
      </div>
    </div>
  );
}

function ComparisonNodeRow({
  node,
  nodeDisplayName: displayName,
  onSelectNode,
}: {
  node: RunComparisonNode;
  nodeDisplayName: string;
  onSelectNode?: (nodeId: string) => void;
}) {
  const details = nodeChangeDetails(node);

  return (
    <article className={`run-comparison-node is-${node.change}`}>
      <button
        aria-label={`查看差异节点 ${displayName}`}
        type="button"
        onClick={() => onSelectNode?.(node.nodeId)}
      >
        <strong>{displayName}</strong>
        <span className={`run-comparison-change change-${node.change}`}>{changeLabel(node.change)}</span>
      </button>
      <div className="run-comparison-details">
        {details.map((detail) => (
          <span key={detail}>{detail}</span>
        ))}
      </div>
    </article>
  );
}

function nodeChangeDetails(node: RunComparisonNode): string[] {
  if (!node.baseline) {
    return ["此前未执行"];
  }
  if (!node.current) {
    return ["本次未执行"];
  }

  const details: string[] = [];
  if (node.baseline.latestStatus !== node.current.latestStatus) {
    details.push(`${nodeStatusLabels[node.baseline.latestStatus]} -> ${nodeStatusLabels[node.current.latestStatus]}`);
  }
  if (node.baseline.runCount !== node.current.runCount) {
    details.push(`执行 ${node.baseline.runCount} -> ${node.current.runCount} 次`);
  }
  if (node.baseline.inputItemCount !== node.current.inputItemCount) {
    details.push(`输入 ${node.baseline.inputItemCount} -> ${node.current.inputItemCount} 项`);
  }
  if (node.baseline.outputItemCount !== node.current.outputItemCount) {
    details.push(`输出 ${node.baseline.outputItemCount} -> ${node.current.outputItemCount} 项`);
  }
  if (node.baseline.errorCount !== node.current.errorCount) {
    details.push(`错误 ${node.baseline.errorCount} -> ${node.current.errorCount} 个`);
  }
  if (node.outputChanged) {
    details.push("输出数据已变化");
  }
  if (node.inputChanged) {
    details.push("输入数据已变化");
  }
  return details.length > 0 ? details : ["执行摘要相同"];
}

function changeLabel(change: RunComparisonNode["change"]): string {
  switch (change) {
    case "added":
      return "本次新增";
    case "removed":
      return "本次未执行";
    case "changed":
      return "有变化";
    default:
      return "未变化";
  }
}
