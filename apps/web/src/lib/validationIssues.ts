import type { ValidationIssue } from "../types";
import { translateFieldLabel } from "./display";
import { connectionKindDisplayLabel } from "./schemaDisplay";

const MESSAGE_LABELS: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/^Field required$/, () => "必填项不能为空"],
  [/^Unknown node type: (.+)$/, (match) => `未知节点类型：${match[1]}`],
  [/^Missing required input: (.+)$/, (match) => `缺少必填输入：${match[1]}`],
  [/^Workflow graph contains a cycle$/, () => "工作流中存在循环依赖"],
  [/^Node IDs must be unique$/, () => "节点 ID 不能重复"],
  [/^Edge IDs must be unique$/, () => "连线 ID 不能重复"],
  [/^Control nodes require a body subflow$/, () => "控制节点需要循环体子流程"],
  [/^Duplicate edge connection: (.+)$/, (match) => `重复连线：${match[1]}`],
  [/^Input handle already connected: (.+)$/, (match) => `输入端口已连接：${match[1]}`],
  [/^Incompatible port schemas: (.+)$/, (match) => `端口数据类型不兼容：${match[1]}`],
  [/^Webhook trigger must not have incoming connections\.$/, () => "Webhook 触发器不能有上游连接。"],
  [/^Webhook endpoint (.+) is already used by node (.+)\.$/, (match) => `Webhook 地址 ${match[1]} 已被节点 ${match[2]} 使用。`],
  [/^Webhook response nodes require a Webhook trigger on every incoming workflow path\.$/, () => "Webhook 响应节点只能位于 Webhook 触发器的下游路径中。"],
  [/^Input should be greater than 0$/, () => "必须大于 0"],
  [/^Workflow timeout must be between 1 and 86400 seconds$/, () => "超时时间必须在 1 到 86400 秒之间"],
];

export function formatValidationIssue(issue: ValidationIssue): string {
  return `${formatValidationPath(issue.path)}：${formatValidationMessage(issue)}`;
}

export function formatValidationSummary(issues: ValidationIssue[], limit = 3): string {
  if (issues.length === 0) {
    return "工作流验证通过。";
  }

  const shownIssues = issues.slice(0, limit).map(formatValidationIssue).join("；");
  const hiddenCount = issues.length - limit;
  const suffix = hiddenCount > 0 ? `；另有 ${hiddenCount} 个问题。` : "";
  return `工作流有 ${issues.length} 个问题：${shownIssues}${suffix}`;
}

function formatValidationPath(path: string): string {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) {
    return "工作流";
  }

  if (parts[0] === "nodes") {
    return formatNodePath(parts);
  }
  if (parts[0] === "edges") {
    return formatEdgePath(parts);
  }
  if (parts[0] === "settings") {
    return formatSettingsPath(parts);
  }

  return translateFieldLabel(parts[0], path);
}

function formatNodePath(parts: string[]): string {
  if (parts.length === 1) {
    return "节点";
  }

  const nodeId = parts[1];
  if (parts[2] === "config" && parts[3]) {
    return `节点 ${nodeId} 的配置 ${translateFieldLabel(parts[3])}`;
  }
  if (parts[2] === "inputs" && parts[3]) {
    return `节点 ${nodeId} 的输入 ${parts[3]}`;
  }
  if (parts[2] === "subflows" && parts[3]) {
    return `节点 ${nodeId} 的子流程 ${parts[3]}`;
  }

  return `节点 ${nodeId}`;
}

function formatEdgePath(parts: string[]): string {
  if (parts.length === 1) {
    return "连线";
  }

  const edgeId = parts[1];
  const field = parts[2];
  if (field === "sourceHandle") {
    return `连线 ${edgeId} 的输出端口`;
  }
  if (field === "targetHandle") {
    return `连线 ${edgeId} 的输入端口`;
  }
  if (field === "source") {
    return `连线 ${edgeId} 的起点节点`;
  }
  if (field === "target") {
    return `连线 ${edgeId} 的终点节点`;
  }

  return `连线 ${edgeId}`;
}

function formatSettingsPath(parts: string[]): string {
  if (parts[1] === "variables" && parts[2]) {
    return `工作流变量 ${parts[2]}`;
  }
  if (parts[1]) {
    return `工作流设置${translateFieldLabel(parts[1])}`;
  }

  return "工作流设置";
}

function formatValidationMessage(issue: ValidationIssue): string {
  const detailsMessage = formatValidationDetailsMessage(issue);
  if (detailsMessage) {
    return detailsMessage;
  }

  const message = issue.message;
  for (const [pattern, formatter] of MESSAGE_LABELS) {
    const match = message.match(pattern);
    if (match) {
      return formatter(match);
    }
  }
  return message;
}

function formatValidationDetailsMessage(issue: ValidationIssue): string | null {
  if (!issue.details) {
    return null;
  }

  if (issue.code === "incompatible_connection_kind") {
    return formatConnectionKindDetailsMessage(issue.details);
  }

  if (issue.code !== "incompatible_schema") {
    return null;
  }

  const sourcePort = stringDetail(issue.details.source_port);
  const targetPort = stringDetail(issue.details.target_port);
  const sourceSchemaLabel = stringDetail(issue.details.source_schema_label);
  const targetSchemaLabel = stringDetail(issue.details.target_schema_label);
  if (!sourcePort || !targetPort || !sourceSchemaLabel || !targetSchemaLabel) {
    return null;
  }

  return `端口数据类型不兼容：${sourcePort} ${sourceSchemaLabel} -> ${targetPort} ${targetSchemaLabel}`;
}

function formatConnectionKindDetailsMessage(details: Record<string, unknown>): string | null {
  const sourcePort = stringDetail(details.source_port);
  const targetPort = stringDetail(details.target_port);
  const sourceConnectionKind = stringDetail(details.source_connection_kind);
  const targetConnectionKind = stringDetail(details.target_connection_kind);
  if (!sourcePort || !targetPort || !sourceConnectionKind || !targetConnectionKind) {
    return null;
  }

  return `端口通道不匹配：${sourcePort} ${connectionKindDisplayLabel(sourceConnectionKind)} -> ${targetPort} ${connectionKindDisplayLabel(targetConnectionKind)}`;
}

function stringDetail(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
