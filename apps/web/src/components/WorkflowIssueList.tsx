import {
  sortWorkflowIssues,
  workflowIssueSeverityLabel,
  workflowIssueSourceLabel,
  type WorkflowIssueItem,
} from "../lib/workflowIssues";

type WorkflowIssueListProps = {
  issues: WorkflowIssueItem[];
  title: string;
  className?: string;
  onSelectIssue: (issue: WorkflowIssueItem) => void;
};

export function WorkflowIssueList({ issues, title, className, onSelectIssue }: WorkflowIssueListProps) {
  if (issues.length === 0) {
    return null;
  }

  const titleId = `workflow-issues-${safeTitleId(title)}`;
  const visibleIssues = sortWorkflowIssues(issues);

  return (
    <section className={["pre-run-issues", className].filter(Boolean).join(" ")} aria-labelledby={titleId}>
      <div className="pre-run-issues-heading">
        <h2 id={titleId}>{title}</h2>
        <span>{issues.length} 个问题</span>
      </div>
      <div className="pre-run-issue-list">
        {visibleIssues.map((issue) => (
          <button key={issue.id} className="pre-run-issue" type="button" onClick={() => onSelectIssue(issue)}>
            <strong>{issue.title}</strong>
            <span className="workflow-issue-card-badges">
              <em>{workflowIssueSourceLabel(issue.source)}</em>
              <em>{workflowIssueSeverityLabel(issue.severity)}</em>
            </span>
            <span>{issue.message}</span>
            <small className="pre-run-issue-meta">
              <em>{issue.location}</em>
              {issue.field ? <em>字段 {issue.field}</em> : null}
              {issue.pathLabel ? <em>位置 {issue.pathLabel}</em> : null}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}

function safeTitleId(title: string): string {
  const id = title.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  return id || "list";
}
