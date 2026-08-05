import type { WorkflowVersionDiff } from "../lib/workflowVersionDiff";
import { nodeDisplayName } from "./runPanelShared";

type WorkflowVersionDiffViewProps = {
  diff: WorkflowVersionDiff;
  nodeDisplayNames: Record<string, string>;
};

export function WorkflowVersionDiffView({ diff, nodeDisplayNames }: WorkflowVersionDiffViewProps) {
  return (
    <section aria-label="版本差异" className="workflow-version-diff">
      <h3>v{diff.baselineVersion} 与当前 v{diff.currentVersion} 的差异</h3>
      {!diff.changed ? <p>与当前版本没有可见差异。</p> : null}
      {diff.changed ? (
        <div className="workflow-version-diff-items">
          <DiffNodeItem label="新增节点" nodeIds={diff.addedNodeIds} nodeDisplayNames={nodeDisplayNames} />
          <DiffNodeItem label="删除节点" nodeIds={diff.removedNodeIds} nodeDisplayNames={nodeDisplayNames} />
          <DiffNodeItem label="节点内容" nodeIds={diff.changedNodeIds} nodeDisplayNames={nodeDisplayNames} />
          <DiffNodeItem label="节点位置" nodeIds={diff.movedNodeIds} nodeDisplayNames={nodeDisplayNames} />
          {diff.addedEdgeCount > 0 || diff.removedEdgeCount > 0 ? (
            <span>连线：新增 {diff.addedEdgeCount}，删除 {diff.removedEdgeCount}</span>
          ) : null}
          {diff.metadataChanged ? <span>工作流信息已变化</span> : null}
          {diff.settingsChanged ? <span>工作流设置已变化</span> : null}
          {diff.annotationsChanged ? <span>画布说明已变化</span> : null}
        </div>
      ) : null}
    </section>
  );
}

function DiffNodeItem({
  label,
  nodeIds,
  nodeDisplayNames,
}: {
  label: string;
  nodeIds: string[];
  nodeDisplayNames: Record<string, string>;
}) {
  if (nodeIds.length === 0) {
    return null;
  }

  return <span>{label}：{nodeIds.map((nodeId) => nodeDisplayName(nodeId, nodeDisplayNames)).join("、")}</span>;
}
