import { isSettingsPreRunIssue, type PreRunIssue, type PreRunIssueSeverity } from "./preRunChecks";
import { formatScopePart } from "./runtimeDisplay";
import type { ValidationIssueItem } from "./validationIssueView";

export type WorkflowIssueSource = "pre_run" | "validation";
export type WorkflowIssueSeverity = PreRunIssueSeverity;

export type WorkflowIssueSourceDefinition = {
  id: WorkflowIssueSource;
  label: string;
  rank: number;
};

export type WorkflowIssueSourceSummary = {
  source: WorkflowIssueSource;
  label: string;
  count: number;
};

export const WORKFLOW_ISSUE_SOURCES: readonly WorkflowIssueSourceDefinition[] = [
  { id: "validation", label: "验证", rank: 0 },
  { id: "pre_run", label: "本地检查", rank: 1 },
] as const;

export type WorkflowIssueTarget =
  | { kind: "node"; nodeId: string; field?: string; path?: string[] }
  | { kind: "edge"; edgeId: string; field?: string; path?: string[] }
  | { kind: "settings"; field?: string }
  | { kind: "workflow" };

export type WorkflowIssueItem = {
  id: string;
  source: WorkflowIssueSource;
  severity: WorkflowIssueSeverity;
  title: string;
  message: string;
  location: string;
  field?: string;
  pathLabel?: string;
  target: WorkflowIssueTarget;
};

export function preRunIssuesToWorkflowIssues(issues: PreRunIssue[]): WorkflowIssueItem[] {
  return issues.map((issue) => {
    if (isSettingsPreRunIssue(issue)) {
      return {
        id: `pre_run:${issue.id}`,
        source: "pre_run",
        severity: issue.severity,
        title: issue.title,
        message: issue.message,
        location: "工作流设置",
        field: issue.field,
        pathLabel: formatWorkflowIssuePathLabel(issue.path),
        target: {
          kind: "settings",
          field: issue.field,
        },
      };
    }

    if (isEdgePreRunIssue(issue)) {
      return {
        id: `pre_run:${issue.id}`,
        source: "pre_run",
        severity: issue.severity,
        title: issue.title,
        message: issue.message,
        location: `连线 ${issue.edgeId}`,
        field: issue.field,
        pathLabel: formatWorkflowIssuePathLabel(issue.path),
        target: {
          kind: "edge",
          edgeId: issue.edgeId,
          path: issue.path,
        },
      };
    }

    return {
      id: `pre_run:${issue.id}`,
      source: "pre_run",
      severity: issue.severity,
      title: issue.title,
      message: issue.message,
      location: `节点 ${issue.nodeId}`,
      field: issue.field,
      pathLabel: formatWorkflowIssuePathLabel(issue.path),
      target: {
        kind: "node",
        nodeId: issue.nodeId,
        field: issue.field,
        path: issue.path,
      },
    };
  });
}

export function validationIssuesToWorkflowIssues(issues: ValidationIssueItem[]): WorkflowIssueItem[] {
  return issues.map((issue) => ({
    id: `validation:${issue.id}`,
    source: "validation",
    severity: "error",
    title: issue.title,
    message: issue.message,
    location: issue.location,
    field: issue.field,
    target: validationIssueTarget(issue),
  }));
}

function isEdgePreRunIssue(issue: PreRunIssue): issue is Extract<PreRunIssue, { targetKind: "edge" }> {
  return "targetKind" in issue && issue.targetKind === "edge";
}

export function sortWorkflowIssues(issues: readonly WorkflowIssueItem[]): WorkflowIssueItem[] {
  return [...issues].sort((left, right) => {
    return (
      severityRank(left.severity) - severityRank(right.severity) ||
      sourceRank(left.source) - sourceRank(right.source) ||
      left.location.localeCompare(right.location, "zh-Hans") ||
      left.message.localeCompare(right.message, "zh-Hans") ||
      left.id.localeCompare(right.id)
    );
  });
}

export function workflowIssueSourceLabel(source: WorkflowIssueSource): string {
  return sourceDefinition(source).label;
}

export function buildWorkflowIssueSourceSummaries(issues: readonly WorkflowIssueItem[]): WorkflowIssueSourceSummary[] {
  return WORKFLOW_ISSUE_SOURCES.map((source) => ({
    source: source.id,
    label: source.label,
    count: issues.filter((issue) => issue.source === source.id).length,
  })).filter((summary) => summary.count > 0);
}

export function workflowIssueSeverityLabel(severity: WorkflowIssueSeverity): string {
  return severity === "warning" ? "警告" : "错误";
}

export function formatWorkflowIssuePathLabel(path: string[] | undefined): string | undefined {
  if (!path || path.length === 0) {
    return undefined;
  }

  return path.map(formatWorkflowIssuePathPart).join(" / ");
}

function formatWorkflowIssuePathPart(part: string): string {
  switch (part) {
    case "root":
      return "主流程";
    case "settings":
      return "工作流设置";
    case "body":
      return "循环体";
    default:
      return formatScopePart(part);
  }
}

function validationIssueTarget(issue: ValidationIssueItem): WorkflowIssueTarget {
  if (issue.targetKind === "node") {
    return {
      kind: "node",
      nodeId: issue.nodeId,
      field: issue.field,
    };
  }
  if (issue.targetKind === "edge") {
    return {
      kind: "edge",
      edgeId: issue.edgeId,
      field: issue.field,
    };
  }
  if (issue.targetKind === "settings") {
    return {
      kind: "settings",
      field: issue.field,
    };
  }
  return { kind: "workflow" };
}

function severityRank(severity: WorkflowIssueSeverity): number {
  return severity === "error" ? 0 : 1;
}

function sourceRank(source: WorkflowIssueSource): number {
  return sourceDefinition(source).rank;
}

function sourceDefinition(source: WorkflowIssueSource): WorkflowIssueSourceDefinition {
  return WORKFLOW_ISSUE_SOURCES.find((definition) => definition.id === source) ?? WORKFLOW_ISSUE_SOURCES[0];
}
