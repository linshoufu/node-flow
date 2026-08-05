import { executionItemMetadata, normalizeExecutionItems, type ExecutionItem } from "./executionItems";
import type { NodeRuntimeExecution, NodeRuntimeState } from "./runState";

export type VisibleExecutionItem = {
  item: ExecutionItem;
  originalIndex: number;
};

export function filterExecutionItems(items: ExecutionItem[], searchQuery: string): VisibleExecutionItem[] {
  const normalizedQuery = normalizeRuntimeSearch(searchQuery);

  return items
    .map((item, originalIndex) => ({ item, originalIndex }))
    .filter(({ item }) => !normalizedQuery || runtimeItemMatches(item, normalizedQuery));
}

export function filterRuntimeExecutions(
  executions: NodeRuntimeExecution[],
  searchQuery: string
): NodeRuntimeExecution[] {
  const normalizedQuery = normalizeRuntimeSearch(searchQuery);

  if (!normalizedQuery) {
    return executions;
  }

  return executions.filter((execution) => runtimeExecutionMatches(execution, normalizedQuery));
}

export function runtimeSearchMatchCount(runtimeState: NodeRuntimeState, searchQuery: string): number {
  const normalizedQuery = normalizeRuntimeSearch(searchQuery);

  if (!normalizedQuery) {
    return 0;
  }

  const executions = runtimeState.executions ?? [];
  let count = 0;

  for (const execution of executions) {
    if (runtimeExecutionContextMatches(execution, normalizedQuery)) {
      count += 1;
    }

    if (execution.inputs !== undefined) {
      const inputItems = execution.inputItems ?? normalizeExecutionItems(execution.inputs);
      count += inputItems.filter((item) => runtimeItemMatches(item, normalizedQuery)).length;
    }

    for (const connection of Object.values(execution.outputs)) {
      count += connection.items.filter((item) => runtimeItemMatches(item, normalizedQuery)).length;
    }
  }

  if (executions.length === 0) {
    if (runtimeValueMatches(runtimeState.inputs, normalizedQuery)) {
      count += 1;
    }

    if (runtimeValueMatches(runtimeState.outputs, normalizedQuery)) {
      count += 1;
    }
  }

  if (Array.isArray(runtimeState.logs)) {
    count += runtimeState.logs.filter((log) => runtimeValueMatches(log, normalizedQuery)).length;
  } else if (runtimeValueMatches(runtimeState.logs, normalizedQuery)) {
    count += 1;
  }

  if (runtimeValueMatches(runtimeState.error, normalizedQuery)) {
    count += 1;
  }

  return count;
}

export function runtimeExecutionMatches(execution: NodeRuntimeExecution, searchQuery: string): boolean {
  const normalizedQuery = normalizeRuntimeSearch(searchQuery);

  if (!normalizedQuery) {
    return true;
  }

  if (runtimeExecutionContextMatches(execution, normalizedQuery)) {
    return true;
  }

  if (execution.inputs !== undefined) {
    const inputItems = execution.inputItems ?? normalizeExecutionItems(execution.inputs);
    if (inputItems.some((item) => runtimeItemMatches(item, normalizedQuery))) {
      return true;
    }
  }

  return Object.values(execution.outputs).some((connection) => {
    return (
      runtimeValueMatches(connection.name, normalizedQuery) ||
      runtimeValueMatches(connection.value, normalizedQuery) ||
      connection.items.some((item) => runtimeItemMatches(item, normalizedQuery))
    );
  });
}

function runtimeExecutionContextMatches(execution: NodeRuntimeExecution, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return false;
  }

  const parts: unknown[] = [
    execution.status,
    nodeRunStatusLabel(execution.status),
    "第 " + (execution.runIndex + 1) + " 次",
    "第 " + (execution.runIndex + 1) + " 次执行",
    formatScope(execution.scope),
    execution.scope.join(" / "),
    execution.logs,
    execution.error,
  ];

  if (typeof execution.durationMs === "number") {
    parts.push(execution.durationMs + " ms");
  }

  for (const event of execution.events) {
    parts.push(
      event.type,
      eventTypeLabel(event.type),
      formatScope(event.scope),
      event.scope.join(" / "),
      event.logs,
      event.error
    );

    if (typeof event.durationMs === "number") {
      parts.push(event.durationMs + " ms");
    }
  }

  return parts.some((part) => runtimeValueMatches(part, normalizedQuery));
}

export function runtimeItemMatches(item: ExecutionItem, normalizedQuery: string): boolean {
  return runtimeValueMatches(item.json, normalizedQuery) || runtimeValueMatches(executionItemMetadata(item), normalizedQuery);
}

export function runtimeValueMatches(value: unknown, searchQuery: string): boolean {
  const normalizedQuery = normalizeRuntimeSearch(searchQuery);

  if (!normalizedQuery || value === undefined) {
    return false;
  }

  return runtimeSearchText(value).toLowerCase().includes(normalizedQuery);
}

export function normalizeRuntimeSearch(searchQuery: string): string {
  return searchQuery.trim().toLowerCase();
}

export function runtimeSearchText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function buildRuntimeInsight(nodeTypeId: string, outputs: unknown): string[] {
  if (nodeTypeId === "data.csv_read") {
    return buildCsvRuntimeInsight(outputs);
  }

  if (nodeTypeId === "control.each_item" || nodeTypeId === "control.foreach") {
    return buildForEachRuntimeInsight(outputs);
  }

  return [];
}

function buildCsvRuntimeInsight(outputs: unknown): string[] {
  if (!isPlainObject(outputs) || !isPlainObject(outputs.success)) {
    return [];
  }

  const lines: string[] = [];
  const { headers, rows, columns } = outputs.success;

  if (Array.isArray(headers)) {
    lines.push("表头：" + headers.map(String).join(", "));
  }

  if (Array.isArray(rows)) {
    lines.push("行数：" + rows.length);
  }

  if (isPlainObject(columns)) {
    lines.push("列：" + Object.keys(columns).join(", "));
  }

  return lines;
}

function buildForEachRuntimeInsight(outputs: unknown): string[] {
  if (!isPlainObject(outputs)) {
    return [];
  }

  for (const outputName of ["success", "done", "error"]) {
    const output = outputs[outputName];
    if (!isPlainObject(output)) {
      continue;
    }

    if (Array.isArray(output.iterations)) {
      return ["迭代次数：" + output.iterations.length];
    }

    for (const countKey of ["iteration_count", "iterations", "count", "total_items"]) {
      const value = output[countKey];
      if (typeof value === "number" && Number.isFinite(value)) {
        return ["迭代次数：" + value];
      }
    }
  }

  return [];
}

export function eventTypeLabel(type: string): string {
  switch (type) {
    case "node_started":
      return "开始执行";
    case "node_succeeded":
      return "执行成功";
    case "node_failed":
      return "执行失败";
    case "node_pinned_data_used":
      return "已使用固定输出";
    case "node_retry_scheduled":
      return "已安排重试";
    case "node_error_handled":
      return "错误已处理";
    default:
      return type;
  }
}

export function formatRuntimeTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatScope(scope: string[]): string {
  if (scope.length === 0) {
    return "主流程";
  }

  return scope.map(formatScopePart).join(" / ");
}

export function formatScopePart(part: string): string {
  if (part.startsWith("iteration:")) {
    const index = Number(part.slice("iteration:".length));
    return Number.isFinite(index) ? "第 " + (index + 1) + " 轮" : part;
  }

  return part;
}

export function logLevel(log: unknown): string {
  if (isPlainObject(log) && typeof log.level === "string") {
    return log.level;
  }

  return "log";
}

export function logLevelClass(log: unknown): string {
  const level = logLevel(log).toLowerCase();
  return ["debug", "info", "warning", "error"].includes(level) ? "is-" + level : "is-log";
}

export function logMessage(log: unknown): string {
  if (isPlainObject(log) && typeof log.message === "string") {
    return log.message;
  }

  return formatUnknown(log);
}

export function logTimestamp(log: unknown): string | undefined {
  return isPlainObject(log) && typeof log.timestamp === "string" ? log.timestamp : undefined;
}

export function logFields(log: unknown): unknown {
  return isPlainObject(log) && isPlainObject(log.fields) && Object.keys(log.fields).length > 0 ? log.fields : undefined;
}

export function nodeRunStatusLabel(status: NodeRuntimeState["status"]): string {
  switch (status) {
    case "running":
      return "运行中";
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "handled":
      return "已处理";
    case "skipped":
      return "已跳过";
    case "cancelled":
      return "已取消";
    case "pending":
      return "等待";
  }
}

export function formatUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

export function formatCompactUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const text = JSON.stringify(value);
  if (!text) {
    return String(value);
  }

  return text.length > 160 ? text.slice(0, 160) + "..." : text;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
