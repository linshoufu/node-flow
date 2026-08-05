import type { ValidationIssue } from "../types";
import { formatValidationIssue } from "./validationIssues";

export type ValidationIssueItem =
  | {
      id: string;
      title: string;
      message: string;
      targetKind: "node";
      nodeId: string;
      field?: string;
      location: string;
    }
  | {
      id: string;
      title: string;
      message: string;
      targetKind: "edge";
      edgeId: string;
      field?: string;
      location: string;
    }
  | {
      id: string;
      title: string;
      message: string;
      targetKind: "settings" | "workflow";
      field?: string;
      location: string;
    };

export function buildValidationIssueItems(issues: ValidationIssue[]): ValidationIssueItem[] {
  return issues.map((issue, index) => {
    const parts = issue.path.split(".").filter(Boolean);
    const id = issue.path || `validation-issue-${index}`;
    const message = formatValidationIssue(issue);

    if (parts[0] === "nodes" && parts[1]) {
      return {
        id,
        title: parts[2] === "config" ? "节点配置问题" : "节点问题",
        message,
        targetKind: "node",
        nodeId: parts[1],
        field: parts[2] === "config" ? parts[3] : undefined,
        location: `节点 ${parts[1]}`,
      };
    }

    if (parts[0] === "edges" && parts[1]) {
      return {
        id,
        title: "连线问题",
        message,
        targetKind: "edge",
        edgeId: parts[1],
        field: parts[2],
        location: `连线 ${parts[1]}`,
      };
    }

    if (parts[0] === "settings") {
      const field = parts[1] === "variables" ? parts[2] : parts[1];
      return {
        id,
        title: "工作流设置问题",
        message,
        targetKind: "settings",
        field,
        location: parts[1] === "variables" && parts[2] ? `工作流变量 ${parts[2]}` : "工作流设置",
      };
    }

    return {
      id,
      title: "工作流问题",
      message,
      targetKind: "workflow",
      location: "工作流",
    };
  });
}
