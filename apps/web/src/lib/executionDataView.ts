import type { ExecutionData, NodeExecution } from "./executionData";
import { formatScope } from "./runtimeDisplay";
import type { NodeRunStatus } from "./runState";

export type ExecutionDataStatusFilter = "all" | NodeRunStatus;

export type ExecutionDataFilter = {
  query: string;
  status: ExecutionDataStatusFilter;
};

export type ExecutionDataStatusCounts = Record<ExecutionDataStatusFilter, number>;
export type ExecutionDataPortDisplayNames = Record<string, Record<string, string>>;

export type ExecutionDataView = {
  nodeIds: string[];
  statusCounts: ExecutionDataStatusCounts;
};

const executionStatuses: NodeRunStatus[] = ["pending", "running", "succeeded", "failed", "handled", "skipped", "cancelled"];

export function buildExecutionDataView(
  data: ExecutionData,
  filter: ExecutionDataFilter,
  nodeDisplayNames: Record<string, string>,
  outputPortDisplayNamesByNodeId: ExecutionDataPortDisplayNames = {}
): ExecutionDataView {
  return {
    nodeIds: filterExecutionNodeIds(data, filter, nodeDisplayNames, outputPortDisplayNamesByNodeId),
    statusCounts: buildStatusCounts(data),
  };
}

export function filterExecutionNodeIds(
  data: ExecutionData,
  filter: ExecutionDataFilter,
  nodeDisplayNames: Record<string, string>,
  outputPortDisplayNamesByNodeId: ExecutionDataPortDisplayNames = {}
): string[] {
  const query = normalize(filter.query);

  return data.nodeOrder.filter((nodeId) => {
    const summary = data.nodeSummaries[nodeId];
    if (filter.status !== "all" && summary?.latestStatus !== filter.status) {
      return false;
    }

    if (!query) {
      return true;
    }

    const executions = data.nodeRuns[nodeId] ?? [];
    const searchableText = [
      nodeId,
      nodeDisplayNames[nodeId],
      summary?.latestStatus,
      summary?.runCount,
      summary?.inputItemCount,
      summary?.outputItemCount,
      ...executions.flatMap((execution) =>
        executionSearchParts(execution, outputPortDisplayNamesByNodeId[nodeId] ?? {})
      ),
    ]
      .filter((part) => part !== undefined && part !== null)
      .map((part) => String(part))
      .join(" ");

    return normalize(searchableText).includes(query);
  });
}

function buildStatusCounts(data: ExecutionData): ExecutionDataStatusCounts {
  const counts: ExecutionDataStatusCounts = {
    all: data.nodeOrder.length,
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    handled: 0,
    skipped: 0,
    cancelled: 0,
  };

  for (const nodeId of data.nodeOrder) {
    const status = data.nodeSummaries[nodeId]?.latestStatus;
    if (status && executionStatuses.includes(status)) {
      counts[status] += 1;
    }
  }

  return counts;
}

function executionSearchParts(
  execution: NodeExecution,
  outputPortDisplayNames: Record<string, string>
): unknown[] {
  return [
    execution.status,
    execution.scope.join(" / "),
    execution.scope.length > 0 ? formatScope(execution.scope) : undefined,
    execution.inputs,
    execution.logs,
    execution.error,
    ...Object.values(execution.outputs).flatMap((connection) => [
      connection.name,
      outputPortDisplayNames[connection.name],
      connection.value,
      connection.items.map((item) => item.json),
    ]),
    ...execution.events.map((event) => event.type),
  ].map(searchPart);
}

function searchPart(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
