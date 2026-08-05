import { useEffect, useMemo, useState } from "react";
import type { EdgeRepairCandidate } from "../lib/edgeRepairCandidates";
import {
  buildWorkflowIssueSourceSummaries,
  sortWorkflowIssues,
  workflowIssueSeverityLabel,
  workflowIssueSourceLabel,
  type WorkflowIssueItem,
  type WorkflowIssueSource,
} from "../lib/workflowIssues";

type WorkflowIssueFilter = "all" | WorkflowIssueSource;

type WorkflowIssuePanelProps = {
  disabled?: boolean;
  issues: WorkflowIssueItem[];
  edgeRepairCandidates?: Record<string, EdgeRepairCandidate[]>;
  onDeleteEdge?: (edgeId: string) => void;
  onDeleteEdges?: (edgeIds: string[]) => void;
  onRepairEdgeTarget?: (edgeId: string, targetHandle: string) => void;
  onSelectIssue: (issue: WorkflowIssueItem) => void;
};

export function WorkflowIssuePanel({
  disabled = false,
  issues,
  edgeRepairCandidates = {},
  onDeleteEdge,
  onDeleteEdges,
  onRepairEdgeTarget,
  onSelectIssue,
}: WorkflowIssuePanelProps) {
  const sourceSummaries = useMemo(() => buildWorkflowIssueSourceSummaries(issues), [issues]);
  const [activeFilter, setActiveFilter] = useState<WorkflowIssueFilter>("all");
  const visibleIssues = useMemo(
    () => sortWorkflowIssues(activeFilter === "all" ? issues : issues.filter((issue) => issue.source === activeFilter)),
    [activeFilter, issues]
  );
  const visibleEdgeIssueIds = useMemo(() => uniqueEdgeIssueIds(visibleIssues), [visibleIssues]);

  useEffect(() => {
    if (activeFilter !== "all" && visibleIssues.length === 0) {
      setActiveFilter("all");
    }
  }, [activeFilter, visibleIssues.length]);

  if (issues.length === 0) {
    return null;
  }

  return (
    <section className="workflow-issue-panel" aria-labelledby="workflow-issue-panel-title">
      <div className="workflow-issue-panel-heading">
        <div>
          <h2 id="workflow-issue-panel-title">问题中心</h2>
          <span>共 {issues.length} 个问题</span>
        </div>
        <div className="workflow-issue-panel-counts" aria-label="问题筛选">
          <button aria-pressed={activeFilter === "all"} type="button" onClick={() => setActiveFilter("all")}>
            全部 {issues.length}
          </button>
          {sourceSummaries.map((summary) => (
            <button
              key={summary.source}
              aria-pressed={activeFilter === summary.source}
              type="button"
              onClick={() => setActiveFilter(summary.source)}
            >
              {summary.label} {summary.count}
            </button>
          ))}
          {(onDeleteEdges || onDeleteEdge) && visibleEdgeIssueIds.length > 1 ? (
            <button
              className="workflow-issue-panel-bulk-action"
              disabled={disabled}
              type="button"
              onClick={() => {
                if (disabled) {
                  return;
                }
                if (onDeleteEdges) {
                  onDeleteEdges(visibleEdgeIssueIds);
                  return;
                }
                visibleEdgeIssueIds.forEach((edgeId) => onDeleteEdge?.(edgeId));
              }}
            >
              删除全部无效连线，共 {visibleEdgeIssueIds.length} 条
            </button>
          ) : null}
        </div>
      </div>

      <div className="workflow-issue-panel-list">
        {visibleIssues.map((issue) => {
          const edgeId = issue.target.kind === "edge" ? issue.target.edgeId : null;
          const hasRepairCandidates = edgeId ? Object.prototype.hasOwnProperty.call(edgeRepairCandidates, edgeId) : false;
          const repairCandidates = edgeId ? edgeRepairCandidates[edgeId] ?? [] : [];
          return (
            <div className="workflow-issue-card" key={issue.id}>
              <button className="workflow-issue-card-main" type="button" onClick={() => onSelectIssue(issue)}>
                <span className="workflow-issue-card-header">
                  <strong>{issue.title}</strong>
                  <span className="workflow-issue-card-badges">
                    <em>{workflowIssueSourceLabel(issue.source)}</em>
                    <em>{workflowIssueSeverityLabel(issue.severity)}</em>
                  </span>
                </span>
                <span>{issue.message}</span>
                <small className="workflow-issue-card-meta">
                  <em>{issue.location}</em>
                  {issue.field ? <em>字段 {issue.field}</em> : null}
                  {issue.pathLabel ? <em>位置 {issue.pathLabel}</em> : null}
                </small>
              </button>
              {edgeId && (onDeleteEdge || (onRepairEdgeTarget && hasRepairCandidates)) ? (
                <div className="workflow-issue-card-actions">
                  {onRepairEdgeTarget && hasRepairCandidates ? (
                    repairCandidates.length > 0 ? (
                      repairCandidates.map((candidate) => (
                        <button
                          aria-label={`改接连线 ${edgeId} 到输入端口 ${candidate.label}`}
                          className="workflow-issue-card-repair-button"
                          disabled={disabled}
                          key={candidate.handle}
                          type="button"
                          onClick={() => {
                            if (!disabled) {
                              onRepairEdgeTarget(edgeId, candidate.handle);
                            }
                          }}
                        >
                          改接到 {candidate.label}
                        </button>
                      ))
                    ) : (
                      <span className="workflow-issue-card-repair-empty">没有可直接改接的输入端口</span>
                    )
                  ) : null}
                  {onDeleteEdge ? (
                    <button
                      className="workflow-issue-card-action"
                      disabled={disabled}
                      type="button"
                      onClick={() => {
                        if (!disabled) {
                          onDeleteEdge(edgeId);
                        }
                      }}
                    >
                      删除连线 {edgeId}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function uniqueEdgeIssueIds(issues: readonly WorkflowIssueItem[]): string[] {
  const edgeIds = new Set<string>();
  for (const issue of issues) {
    if (issue.target.kind === "edge") {
      edgeIds.add(issue.target.edgeId);
    }
  }
  return [...edgeIds];
}
