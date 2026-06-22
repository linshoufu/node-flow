import type { WorkflowDocument, WorkflowNode, WorkflowSubflow } from "../types";

export type PreRunIssueSeverity = "error" | "warning";

export type PreRunIssue = {
  id: string;
  nodeId: string;
  nodeType: string;
  severity: PreRunIssueSeverity;
  title: string;
  message: string;
  field?: string;
  path?: string[];
};

export function buildPreRunIssues(workflow: WorkflowDocument): PreRunIssue[] {
  return collectNodeIssues(workflow.nodes, ["root"]);
}

function collectNodeIssues(nodes: WorkflowNode[], parentPath: string[]): PreRunIssue[] {
  return nodes.flatMap((node) => {
    const nodePath = [...parentPath, node.id];
    return [...issuesForNode(node, nodePath), ...subflowIssues(node, nodePath)];
  });
}

function subflowIssues(node: WorkflowNode, nodePath: string[]): PreRunIssue[] {
  if (!node.subflows) {
    return [];
  }

  return Object.entries(node.subflows).flatMap(([subflowName, subflow]) =>
    collectSubflowIssues(subflowName, subflow, nodePath)
  );
}

function collectSubflowIssues(subflowName: string, subflow: WorkflowSubflow, nodePath: string[]): PreRunIssue[] {
  return collectNodeIssues(subflow.nodes, [...nodePath, subflowName]);
}

function issuesForNode(node: WorkflowNode, path: string[]): PreRunIssue[] {
  switch (node.type) {
    case "http.request":
      return [
        requiredFieldIssue(node, path, "method", "HTTP 请求配置不完整", "HTTP 请求缺少请求方法。"),
        requiredFieldIssue(node, path, "url", "HTTP 请求配置不完整", "HTTP 请求缺少 URL。"),
      ].filter(isIssue);
    case "data.csv_read":
      return [requiredFieldIssue(node, path, "path", "CSV 读取配置不完整", "读取 CSV 缺少文件路径。")].filter(
        isIssue
      );
    case "assert.status_code":
      return statusCodeAssertionIssues(node, path);
    case "test.write_report":
      return [
        requiredFieldIssue(node, path, "path", "测试报告配置不完整", "写入测试报告缺少输出路径。"),
      ].filter(isIssue);
    case "control.foreach":
      return [
        requiredFieldIssue(
          node,
          path,
          "items_expression",
          "遍历循环配置不完整",
          "遍历循环缺少循环数据来源。"
        ),
      ].filter(isIssue);
    default:
      return [];
  }
}

function statusCodeAssertionIssues(node: WorkflowNode, path: string[]): PreRunIssue[] {
  if (!hasConfigField(node, "expected") || !isExplicitEmptyConfigValue(node.config.expected)) {
    return [];
  }

  return [
    issue(node, path, "expected", "状态码断言配置不完整", "状态码断言缺少期望状态码。"),
  ];
}

function requiredFieldIssue(
  node: WorkflowNode,
  path: string[],
  field: string,
  title: string,
  message: string
): PreRunIssue | undefined {
  if (!isEmptyConfigValue(node.config[field])) {
    return undefined;
  }

  return issue(node, path, field, title, message);
}

function issue(node: WorkflowNode, path: string[], field: string, title: string, message: string): PreRunIssue {
  return {
    id: `${path.join("/")}:${field}`,
    nodeId: node.id,
    nodeType: node.type,
    severity: "error",
    title,
    message,
    field,
    path,
  };
}

function isEmptyConfigValue(value: unknown): value is null | undefined | string {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function isExplicitEmptyConfigValue(value: unknown): value is null | string {
  return value === null || (typeof value === "string" && value.trim() === "");
}

function hasConfigField(node: WorkflowNode, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(node.config, field);
}

function isIssue(issue: PreRunIssue | undefined): issue is PreRunIssue {
  return issue !== undefined;
}
