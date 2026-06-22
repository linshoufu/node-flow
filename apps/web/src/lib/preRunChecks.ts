import type { WorkflowDocument, WorkflowNode } from "../types";

export type PreRunIssueSeverity = "error" | "warning";

export type PreRunIssue = {
  id: string;
  nodeId: string;
  nodeType: string;
  severity: PreRunIssueSeverity;
  title: string;
  message: string;
  field?: string;
};

export function buildPreRunIssues(workflow: WorkflowDocument): PreRunIssue[] {
  return workflow.nodes.flatMap((node) => issuesForNode(node));
}

function issuesForNode(node: WorkflowNode): PreRunIssue[] {
  switch (node.type) {
    case "http.request":
      return [
        requiredFieldIssue(node, "method", "HTTP 请求配置不完整", "HTTP 请求缺少请求方法。"),
        requiredFieldIssue(node, "url", "HTTP 请求配置不完整", "HTTP 请求缺少 URL。"),
      ].filter(isIssue);
    case "data.csv_read":
      return [requiredFieldIssue(node, "path", "CSV 读取配置不完整", "读取 CSV 缺少文件路径。")].filter(isIssue);
    case "assert.status_code":
      return statusCodeAssertionIssues(node);
    case "test.write_report":
      return [requiredFieldIssue(node, "path", "测试报告配置不完整", "写入测试报告缺少输出路径。")].filter(isIssue);
    case "control.foreach":
      return [
        requiredFieldIssue(node, "items_expression", "遍历循环配置不完整", "遍历循环缺少循环数据来源。"),
      ].filter(isIssue);
    default:
      return [];
  }
}

function statusCodeAssertionIssues(node: WorkflowNode): PreRunIssue[] {
  const issues: PreRunIssue[] = [];
  const hasActualSource = ["actual", "actual_expression", "status_code", "status_expression"].some(
    (field) => !isEmptyConfigValue(node.config[field])
  );

  if (!hasActualSource) {
    issues.push(
      issue(
        node,
        "actual",
        "状态码断言配置不完整",
        "状态码断言缺少实际状态码来源。"
      )
    );
  }

  const expectedIssue = requiredFieldIssue(
    node,
    "expected",
    "状态码断言配置不完整",
    "状态码断言缺少期望状态码。"
  );
  if (expectedIssue) {
    issues.push(expectedIssue);
  }

  return issues;
}

function requiredFieldIssue(node: WorkflowNode, field: string, title: string, message: string): PreRunIssue | undefined {
  if (!isEmptyConfigValue(node.config[field])) {
    return undefined;
  }

  return issue(node, field, title, message);
}

function issue(node: WorkflowNode, field: string, title: string, message: string): PreRunIssue {
  return {
    id: `${node.id}:${field}`,
    nodeId: node.id,
    nodeType: node.type,
    severity: "error",
    title,
    message,
    field,
  };
}

function isEmptyConfigValue(value: unknown): value is null | undefined | string {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function isIssue(issue: PreRunIssue | undefined): issue is PreRunIssue {
  return issue !== undefined;
}
