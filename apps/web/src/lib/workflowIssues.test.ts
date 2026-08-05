import { describe, expect, it } from "vitest";
import type { PreRunIssue } from "./preRunChecks";
import type { ValidationIssueItem } from "./validationIssueView";
import {
  buildWorkflowIssueSourceSummaries,
  formatWorkflowIssuePathLabel,
  preRunIssuesToWorkflowIssues,
  sortWorkflowIssues,
  validationIssuesToWorkflowIssues,
  WORKFLOW_ISSUE_SOURCES,
  workflowIssueSeverityLabel,
  workflowIssueSourceLabel,
} from "./workflowIssues";

describe("workflow issue adapters", () => {
  it("adapts pre-run issues into unified workflow issue items", () => {
    const issue: PreRunIssue = {
      id: "root/request:url",
      nodeId: "request",
      nodeType: "http.request",
      severity: "error",
      title: "HTTP 请求配置不完整",
      message: "HTTP 请求缺少 URL。",
      field: "url",
      path: ["root", "request"],
    };

    expect(preRunIssuesToWorkflowIssues([issue])).toEqual([
      {
        id: "pre_run:root/request:url",
        source: "pre_run",
        severity: "error",
        title: "HTTP 请求配置不完整",
        message: "HTTP 请求缺少 URL。",
        location: "节点 request",
        field: "url",
        pathLabel: "主流程 / request",
        target: {
          kind: "node",
          nodeId: "request",
          field: "url",
          path: ["root", "request"],
        },
      },
    ]);
  });

  it("adapts pre-run settings issues into workflow settings targets", () => {
    const issue: PreRunIssue = {
      id: "root:settings:timeout_seconds",
      severity: "error",
      title: "工作流设置不合法",
      message: "超时时间必须在 1 到 86400 秒之间。",
      field: "timeout_seconds",
      path: ["root", "settings"],
      targetKind: "settings",
    };

    expect(preRunIssuesToWorkflowIssues([issue])).toEqual([
      {
        id: "pre_run:root:settings:timeout_seconds",
        source: "pre_run",
        severity: "error",
        title: "工作流设置不合法",
        message: "超时时间必须在 1 到 86400 秒之间。",
        location: "工作流设置",
        field: "timeout_seconds",
        pathLabel: "主流程 / 工作流设置",
        target: {
          kind: "settings",
          field: "timeout_seconds",
        },
      },
    ]);
  });

  it("adapts pre-run edge issues into edge targets", () => {
    const issue: PreRunIssue = {
      id: "root:edge:edge_old_port",
      edgeId: "edge_old_port",
      severity: "error",
      title: "连线无效",
      message: "目标节点没有输入端口 old_input。",
      path: ["root"],
      targetKind: "edge",
    };

    expect(preRunIssuesToWorkflowIssues([issue])).toEqual([
      {
        id: "pre_run:root:edge:edge_old_port",
        source: "pre_run",
        severity: "error",
        title: "连线无效",
        message: "目标节点没有输入端口 old_input。",
        location: "连线 edge_old_port",
        field: undefined,
        pathLabel: "主流程",
        target: {
          kind: "edge",
          edgeId: "edge_old_port",
          path: ["root"],
        },
      },
    ]);
  });

  it("adapts backend validation items into unified workflow issue items", () => {
    const issue: ValidationIssueItem = {
      id: "nodes.request.config.url",
      title: "节点配置问题",
      message: "节点 request 的配置 URL：必填项不能为空",
      targetKind: "node",
      nodeId: "request",
      field: "url",
      location: "节点 request",
    };

    expect(validationIssuesToWorkflowIssues([issue])).toEqual([
      {
        id: "validation:nodes.request.config.url",
        source: "validation",
        severity: "error",
        title: "节点配置问题",
        message: "节点 request 的配置 URL：必填项不能为空",
        location: "节点 request",
        field: "url",
        target: {
          kind: "node",
          nodeId: "request",
          field: "url",
        },
      },
    ]);
  });

  it("sorts workflow issues by severity, source, location, and id without mutating input", () => {
    const issues = [
      workflowIssue("pre_run:warning-b", "pre_run", "warning", "节点 B", "字段 b"),
      workflowIssue("validation:error-b", "validation", "error", "节点 B", "字段 b"),
      workflowIssue("pre_run:error-a", "pre_run", "error", "节点 A", "字段 a"),
      workflowIssue("validation:warning-a", "validation", "warning", "节点 A", "字段 a"),
      workflowIssue("validation:error-a", "validation", "error", "节点 A", "字段 a"),
    ] as const;

    expect(sortWorkflowIssues([...issues]).map((issue) => issue.id)).toEqual([
      "validation:error-a",
      "validation:error-b",
      "pre_run:error-a",
      "validation:warning-a",
      "pre_run:warning-b",
    ]);
    expect(issues.map((issue) => issue.id)).toEqual([
      "pre_run:warning-b",
      "validation:error-b",
      "pre_run:error-a",
      "validation:warning-a",
      "validation:error-a",
    ]);
  });

  it("provides shared Chinese labels for issue sources and severities", () => {
    expect(WORKFLOW_ISSUE_SOURCES.map((source) => source.id)).toEqual(["validation", "pre_run"]);
    expect(WORKFLOW_ISSUE_SOURCES.map((source) => source.label)).toEqual(["验证", "本地检查"]);
    expect(workflowIssueSourceLabel("validation")).toBe("验证");
    expect(workflowIssueSourceLabel("pre_run")).toBe("本地检查");
    expect(workflowIssueSeverityLabel("error")).toBe("错误");
    expect(workflowIssueSeverityLabel("warning")).toBe("警告");
  });

  it("builds source summaries in product order and omits empty sources by default", () => {
    expect(
      buildWorkflowIssueSourceSummaries([
        workflowIssue("pre_run:a", "pre_run", "error", "节点 A", "字段 a"),
        workflowIssue("pre_run:b", "pre_run", "warning", "节点 B", "字段 b"),
      ])
    ).toEqual([{ source: "pre_run", label: "本地检查", count: 2 }]);

    expect(
      buildWorkflowIssueSourceSummaries([
        workflowIssue("pre_run:a", "pre_run", "error", "节点 A", "字段 a"),
        workflowIssue("validation:a", "validation", "error", "节点 A", "字段 a"),
      ])
    ).toEqual([
      { source: "validation", label: "验证", count: 1 },
      { source: "pre_run", label: "本地检查", count: 1 },
    ]);
  });

  it("formats internal workflow paths for product display", () => {
    expect(formatWorkflowIssuePathLabel(["root", "each", "body", "request"])).toBe(
      "主流程 / each / 循环体 / request"
    );
    expect(formatWorkflowIssuePathLabel(["each_row", "iteration:0", "assert"])).toBe("each_row / 第 1 轮 / assert");
    expect(formatWorkflowIssuePathLabel(undefined)).toBeUndefined();
  });
});

function workflowIssue(
  id: string,
  source: "pre_run" | "validation",
  severity: "error" | "warning",
  location: string,
  message: string,
) {
  return {
    id,
    source,
    severity,
    title: "问题",
    message,
    location,
    target: { kind: "workflow" as const },
  };
}
