import type { RunEvent } from "../types";
import {
  flattenPortExecutionItems,
  normalizeExecutionItems,
  normalizeExecutionItemContext,
  normalizePortExecutionItems,
  type ExecutionItem,
  type ExecutionItemContext,
} from "./executionItems";
import type { NodeRunStatus } from "./runState";


export type ExecutionConnection = {
  name: string;
  value: unknown;
  items: ExecutionItem[];
};

export type NodeExecution = {
  nodeId: string;
  runIndex: number;
  attempt?: number;
  status: NodeRunStatus;
  scope: string[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  inputs?: unknown;
  inputItems?: ExecutionItem[];
  itemContext?: ExecutionItemContext;
  outputs: Record<string, ExecutionConnection>;
  logs?: unknown;
  error?: unknown;
  events: RunEvent[];
};

export type NodeExecutionSummary = {
  nodeId: string;
  runCount: number;
  latestStatus: NodeRunStatus;
  inputItemCount: number;
  outputConnectionCount: number;
  outputItemCount: number;
  errorCount: number;
};

export type ExecutionData = {
  nodeOrder: string[];
  nodeRuns: Record<string, NodeExecution[]>;
  nodeSummaries: Record<string, NodeExecutionSummary>;
  events: RunEvent[];
};

export function buildExecutionData(events: RunEvent[]): ExecutionData {
  const data: ExecutionData = {
    nodeOrder: [],
    nodeRuns: {},
    nodeSummaries: {},
    events,
  };

  for (const event of events) {
    if (!event.node_id) {
      continue;
    }

    const nodeId = event.node_id;
    if (!data.nodeRuns[nodeId]) {
      data.nodeRuns[nodeId] = [];
      data.nodeOrder.push(nodeId);
    }

    const execution = executionForEvent(data.nodeRuns[nodeId], nodeId, event);
    execution.events.push(event);

    if (event.type === "node_started") {
      execution.status = "running";
      execution.startedAt = event.timestamp;
      execution.inputs = event.payload.inputs;
      execution.inputItems = flattenPortExecutionItems(event.payload.input_items) ?? normalizeExecutionItems(event.payload.inputs);
      execution.itemContext = normalizeExecutionItemContext(event.payload.item_context);
      execution.scope = [...(event.scope ?? [])];
      execution.attempt = readAttempt(event.payload) ?? execution.attempt;
      returnIfNoDuration(event, execution);
      continue;
    }

    if (event.type === "node_succeeded") {
      execution.status = "succeeded";
      execution.completedAt = event.timestamp;
      execution.outputs = normalizeOutputs(event.payload.outputs, event.payload.output_items);
      execution.logs = mergeLogs(execution.logs, event.payload.logs);
      execution.durationMs = readDurationMs(event);
      execution.scope = [...(event.scope ?? execution.scope)];
      execution.attempt = readAttempt(event.payload) ?? execution.attempt;
      continue;
    }

    if (event.type === "node_skipped") {
      execution.status = "skipped";
      execution.completedAt = event.timestamp;
      execution.outputs = normalizeOutputs(event.payload.outputs, event.payload.output_items);
      execution.scope = [...(event.scope ?? execution.scope)];
      continue;
    }

    if (event.type === "node_failed") {
      execution.status = "failed";
      execution.completedAt = event.timestamp;
      execution.error = event.payload.error;
      execution.logs = mergeLogs(execution.logs, event.payload.logs);
      execution.durationMs = readDurationMs(event);
      execution.scope = [...(event.scope ?? execution.scope)];
      execution.attempt = readAttempt(event.payload) ?? execution.attempt;
      continue;
    }

    if (event.type === "node_error_handled") {
      execution.status = "handled";
      execution.completedAt = event.timestamp;
      execution.error = event.payload.error ?? execution.error;
      execution.outputs = normalizeOutputs(event.payload.outputs, event.payload.output_items);
      execution.scope = [...(event.scope ?? execution.scope)];
      execution.attempt = readAttempt(event.payload) ?? execution.attempt;
    }
  }

  data.nodeSummaries = buildNodeSummaries(data.nodeRuns);
  return data;
}

function buildNodeSummaries(nodeRuns: Record<string, NodeExecution[]>): Record<string, NodeExecutionSummary> {
  return Object.fromEntries(
    Object.entries(nodeRuns).map(([nodeId, runs]) => {
      const latestRun = runs[runs.length - 1];
      const outputConnectionCount = runs.reduce(
        (count, run) => count + Object.keys(run.outputs).length,
        0
      );
      const inputItemCount = runs.reduce(
        (count, run) => count + (run.inputItems?.length ?? 0),
        0
      );
      const outputItemCount = runs.reduce(
        (count, run) => count + Object.values(run.outputs).reduce((items, connection) => items + connection.items.length, 0),
        0
      );
      const errorCount = runs.filter((run) => run.status === "failed" || run.error !== undefined).length;

      return [
        nodeId,
        {
          nodeId,
          runCount: runs.length,
          latestStatus: latestRun?.status ?? "pending",
          inputItemCount,
          outputConnectionCount,
          outputItemCount,
          errorCount,
        },
      ];
    })
  );
}

export function latestNodeExecution(data: ExecutionData, nodeId: string): NodeExecution | undefined {
  const runs = data.nodeRuns[nodeId];
  return runs?.[runs.length - 1];
}

function executionForEvent(runs: NodeExecution[], nodeId: string, event: RunEvent): NodeExecution {
  const lastRun = runs[runs.length - 1];
  if ((event.type === "node_error_handled" || event.type === "node_retry_scheduled") && lastRun) {
    return lastRun;
  }
  if (event.type !== "node_started" && lastRun?.status === "running") {
    return lastRun;
  }

  const nextRun: NodeExecution = {
    nodeId,
    runIndex: runs.length,
    status:
      event.type === "node_failed"
        ? "failed"
        : event.type === "node_succeeded"
          ? "succeeded"
          : event.type === "node_skipped"
            ? "skipped"
          : event.type === "node_error_handled"
            ? "handled"
            : "running",
    scope: [...(event.scope ?? [])],
    outputs: {},
    events: [],
  };
  runs.push(nextRun);
  return nextRun;
}

function normalizeOutputs(outputs: unknown, outputItems?: unknown): Record<string, ExecutionConnection> {
  if (!isRecord(outputs)) {
    return {};
  }

  const authoritativeItems = normalizePortExecutionItems(outputItems);

  return Object.fromEntries(
    Object.entries(outputs).map(([name, value]) => [
      name,
      {
        name,
        value,
        items: authoritativeItems?.[name] ?? normalizeExecutionItems(value),
      },
    ])
  );
}

function readDurationMs(event: RunEvent): number | undefined {
  const value = event.payload.duration_ms;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readAttempt(payload: Record<string, unknown>): number | undefined {
  const value = payload.attempt;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function returnIfNoDuration(event: RunEvent, execution: NodeExecution) {
  const durationMs = readDurationMs(event);
  if (durationMs !== undefined) {
    execution.durationMs = durationMs;
  }
}

function mergeLogs(currentLogs: unknown, nextLogs: unknown): unknown {
  if (nextLogs === undefined) {
    return currentLogs;
  }

  if (currentLogs === undefined) {
    return nextLogs;
  }

  if (Array.isArray(currentLogs) && Array.isArray(nextLogs)) {
    return [...currentLogs, ...nextLogs];
  }

  return [currentLogs, nextLogs];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
