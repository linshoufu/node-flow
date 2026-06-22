import type { PreRunIssue } from "../lib/preRunChecks";

type PreRunIssueListProps = {
  issues: PreRunIssue[];
  onSelectIssue: (issue: PreRunIssue) => void;
};

export function PreRunIssueList({ issues, onSelectIssue }: PreRunIssueListProps) {
  if (issues.length === 0) {
    return null;
  }

  return (
    <section className="pre-run-issues" aria-labelledby="pre-run-issues-title">
      <div className="pre-run-issues-heading">
        <h2 id="pre-run-issues-title">运行前检查</h2>
        <span>{issues.length} 个问题</span>
      </div>
      <div className="pre-run-issue-list">
        {issues.map((issue) => (
          <button key={issue.id} className="pre-run-issue" type="button" onClick={() => onSelectIssue(issue)}>
            <strong>{issue.title}</strong>
            <span>{issue.message}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
