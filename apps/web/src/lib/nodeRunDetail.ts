import { latestNodeExecution, type ExecutionData, type NodeExecution, type NodeExecutionSummary } from "./executionData";
import type { NodeRunStatus } from "./runState";

export type NodeRunDetail = {
  nodeId: string;
  hasData: boolean;
  status: NodeRunStatus;
  executionCount: number;
  latestRunIndex: number | null;
  latestScope: string[];
  latestDurationMs?: number;
  inputItemCount: number;
  outputItemCount: number;
  latestInputItemCount: number;
  latestOutputItemCount: number;
  eventCount: number;
  latestEventCount: number;
  errorCount: number;
  latestExecution?: NodeExecution;
  summary?: NodeExecutionSummary;
};

export function buildNodeRunDetail(data: ExecutionData, nodeId: string): NodeRunDetail {
  const summary = data.nodeSummaries[nodeId];
  const latestExecution = latestNodeExecution(data, nodeId);

  if (!summary || !latestExecution) {
    return {
      nodeId,
      hasData: false,
      status: "pending",
      executionCount: 0,
      latestRunIndex: null,
      latestScope: [],
      latestDurationMs: undefined,
      inputItemCount: 0,
      outputItemCount: 0,
      latestInputItemCount: 0,
      latestOutputItemCount: 0,
      eventCount: 0,
      latestEventCount: 0,
      errorCount: 0,
      latestExecution: undefined,
      summary: undefined,
    };
  }

  return {
    nodeId,
    hasData: true,
    status: summary.latestStatus,
    executionCount: summary.runCount,
    latestRunIndex: latestExecution.runIndex,
    latestScope: [...latestExecution.scope],
    latestDurationMs: latestExecution.durationMs,
    inputItemCount: summary.inputItemCount,
    outputItemCount: summary.outputItemCount,
    latestInputItemCount: latestExecution.inputItems?.length ?? 0,
    latestOutputItemCount: latestOutputItemCount(latestExecution),
    eventCount: data.events.filter((event) => event.node_id === nodeId).length,
    latestEventCount: latestExecution.events.length,
    errorCount: summary.errorCount,
    latestExecution,
    summary,
  };
}

function latestOutputItemCount(execution: NodeExecution): number {
  return Object.values(execution.outputs).reduce((count, connection) => count + connection.items.length, 0);
}
