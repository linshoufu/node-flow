import type { PreRunIssue } from "../lib/preRunChecks";
import { preRunIssuesToWorkflowIssues } from "../lib/workflowIssues";
import { WorkflowIssueList } from "./WorkflowIssueList";

type PreRunIssueListProps = {
  issues: PreRunIssue[];
  onSelectIssue: (issue: PreRunIssue) => void;
};

export function PreRunIssueList({ issues, onSelectIssue }: PreRunIssueListProps) {
  const issueById = new Map(issues.map((issue) => [`pre_run:${issue.id}`, issue]));

  return (
    <WorkflowIssueList
      issues={preRunIssuesToWorkflowIssues(issues)}
      title="运行前检查"
      onSelectIssue={(issue) => {
        const sourceIssue = issueById.get(issue.id);
        if (sourceIssue) {
          onSelectIssue(sourceIssue);
        }
      }}
    />
  );
}
