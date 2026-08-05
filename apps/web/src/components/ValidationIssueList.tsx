import type { ValidationIssueItem } from "../lib/validationIssueView";
import { validationIssuesToWorkflowIssues } from "../lib/workflowIssues";
import { WorkflowIssueList } from "./WorkflowIssueList";

type ValidationIssueListProps = {
  issues: ValidationIssueItem[];
  onSelectIssue: (issue: ValidationIssueItem) => void;
};

export function ValidationIssueList({ issues, onSelectIssue }: ValidationIssueListProps) {
  const issueById = new Map(issues.map((issue) => [`validation:${issue.id}`, issue]));

  return (
    <WorkflowIssueList
      className="validation-issues"
      issues={validationIssuesToWorkflowIssues(issues)}
      title="工作流验证"
      onSelectIssue={(issue) => {
        const sourceIssue = issueById.get(issue.id);
        if (sourceIssue) {
          onSelectIssue(sourceIssue);
        }
      }}
    />
  );
}
