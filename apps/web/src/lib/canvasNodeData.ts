import { buildCanvasNodeRuntimeSummary, type CanvasNodeRuntimeSummary } from "./canvasNodeRuntimeSummary";
import { translateCategory } from "./display";
import { workflowNodeDisplayName } from "./nodeDisplayNames";
import { resolveNodeInputPorts, resolveNodeOutputPorts } from "./nodePorts";
import type { NodeRunDetail } from "./nodeRunDetail";
import type { NodeRuntimeState } from "./runState";
import type { WorkflowIssueItem } from "./workflowIssues";
import type { NodePort, NodeType, WorkflowNode } from "../types";

export type CanvasNodePortEntry = [string, NodePort];

export type CanvasNodeData = {
  description?: string;
  displayName: string;
  isDisabled: boolean;
  hasPinnedData: boolean;
  inputPorts: CanvasNodePortEntry[];
  issues?: CanvasNodeIssueSummary;
  notes?: string;
  outputPorts: CanvasNodePortEntry[];
  runSummary: CanvasNodeRuntimeSummary | null;
  runtimeStatus?: NodeRuntimeState["status"];
  runtimeStatusLabel?: string;
  subtitle: string;
  subtitleTitle?: string;
};

export type CanvasNodeIssueSummary = {
  count: number;
  errorCount: number;
  firstIssue: WorkflowIssueItem;
  label: string;
  title: string;
  warningCount: number;
};

export function buildCanvasNodeData({
  issues = [],
  node,
  nodeType,
  runDetail,
  runtimeState,
}: {
  issues?: WorkflowIssueItem[];
  node: WorkflowNode;
  nodeType?: NodeType;
  runDetail?: NodeRunDetail;
  runtimeState?: NodeRuntimeState;
}): CanvasNodeData {
  const runtimeStatus = runtimeState?.status !== "pending" ? runtimeState?.status : undefined;

  return {
    description: nodeType?.description,
    displayName: workflowNodeDisplayName(node, nodeType),
    isDisabled: Boolean(node.disabled),
    hasPinnedData: Boolean(node.pinnedData && Object.keys(node.pinnedData).length > 0),
    inputPorts: nodeType ? Object.entries(resolveNodeInputPorts(node, nodeType)) : [],
    issues: buildIssueSummary(issues),
    notes: node.notes || undefined,
    outputPorts: nodeType ? Object.entries(resolveNodeOutputPorts(node, nodeType)) : [],
    runSummary: buildCanvasNodeRuntimeSummary({ runDetail, runtimeState }),
    runtimeStatus,
    runtimeStatusLabel: runtimeStatus ? runStatusLabel(runtimeStatus) : undefined,
    subtitle: nodeType ? translateCategory(nodeType.category) : "类型未加载",
    subtitleTitle: nodeType ? undefined : node.type,
  };
}

function buildIssueSummary(issues: WorkflowIssueItem[]): CanvasNodeIssueSummary | undefined {
  if (issues.length === 0) {
    return undefined;
  }

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.length - errorCount;
  const details = [
    errorCount > 0 ? `${errorCount} 个错误` : null,
    warningCount > 0 ? `${warningCount} 个警告` : null,
  ].filter((detail): detail is string => Boolean(detail));

  return {
    count: issues.length,
    errorCount,
    firstIssue: issues[0],
    label: `${issues.length} 个问题`,
    title: `此节点有 ${issues.length} 个问题：${details.join("，")}`,
    warningCount,
  };
}

function runStatusLabel(status: Exclude<NodeRuntimeState["status"], "pending">) {
  switch (status) {
    case "running":
      return "运行中";
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "skipped":
      return "已跳过";
    case "cancelled":
      return "已取消";
  }
}
