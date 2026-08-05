import type { RunEvent, RunStatus, WorkflowNode } from "../types";
import { buildExecutionData, type ExecutionConnection, type NodeExecution } from "./executionData";
import type { ExecutionItem, ExecutionItemContext } from "./executionItems";

export type NodeRunStatus = "pending" | "running" | "succeeded" | "failed" | "handled" | "skipped" | "cancelled";

export type NodeRuntimeState = {
  nodeId: string;
  status: NodeRunStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  inputs?: unknown;
  inputItems?: ExecutionItem[];
  itemContext?: ExecutionItemContext;
  outputs?: unknown;
  error?: unknown;
  logs?: unknown;
  scopes: string[][];
  events?: NodeRuntimeEvent[];
  executions?: NodeRuntimeExecution[];
};

export type NodeRuntimeEvent = {
  type: string;
  timestamp: string;
  scope: string[];
  attempt?: number;
  nextAttempt?: number;
  delayMs?: number;
  mode?: string;
  inputs?: unknown;
  outputs?: unknown;
  logs?: unknown;
  error?: unknown;
  durationMs?: number;
};

export type NodeRuntimeExecution = {
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
  events: NodeRuntimeEvent[];
};

export function buildNodeRunStates(
  nodes: WorkflowNode[],
  events: RunEvent[],
  runStatus?: RunStatus | "idle" | null
): Record<string, NodeRuntimeState> {
  return buildNodeRunStatesForNodeIds(
    nodes.map((node) => node.id),
    events,
    runStatus
  );
}

export function buildNodeRunStatesForNodeIds(
  nodeIds: string[],
  events: RunEvent[],
  runStatus?: RunStatus | "idle" | null
): Record<string, NodeRuntimeState> {
  const executionData = buildExecutionData(events);
  const states: Record<string, NodeRuntimeState> = Object.fromEntries(
    nodeIds.map((nodeId) => [nodeId, nodeRuntimeStateFromExecutions(nodeId, executionData.nodeRuns[nodeId] ?? [])])
  );

  if (runStatus === "cancelled") {
    for (const state of Object.values(states)) {
      if (state.status === "running") {
        state.status = "cancelled";
        const lastExecution = state.executions?.[state.executions.length - 1];
        if (lastExecution?.status === "running") {
          lastExecution.status = "cancelled";
        }
      } else if (state.status === "pending") {
        state.status = "skipped";
      }
    }
  }

  return states;
}

function nodeRuntimeStateFromExecutions(nodeId: string, executions: NodeExecution[]): NodeRuntimeState {
  if (executions.length === 0) {
    return {
      nodeId,
      status: "pending",
      scopes: [],
      events: [],
      executions: [],
    };
  }

  const latestExecution = executions[executions.length - 1];
  const runtimeExecutions = executions.map(runtimeExecutionFromNodeExecution);

  return {
    nodeId,
    status: latestExecution.status,
    startedAt: latestExecution.startedAt,
    completedAt: latestExecution.completedAt,
    durationMs: latestExecution.durationMs,
    inputs: latestExecution.inputs,
    inputItems: latestExecution.inputItems,
    itemContext: latestExecution.itemContext,
    outputs: connectionValues(latestExecution.outputs),
    error: latestExecution.error,
    logs: latestExecution.logs,
    scopes: executions.flatMap((execution) => execution.events).reduce<string[][]>((scopes, event) => addScope(scopes, event.scope ?? []), []),
    events: latestExecution.events.map(runtimeEventFromRunEvent),
    executions: runtimeExecutions,
  };
}

function runtimeExecutionFromNodeExecution(execution: NodeExecution): NodeRuntimeExecution {
  return {
    runIndex: execution.runIndex,
    attempt: execution.attempt,
    status: execution.status,
    scope: [...execution.scope],
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    durationMs: execution.durationMs,
    inputs: execution.inputs,
    inputItems: execution.inputItems,
    itemContext: execution.itemContext,
    outputs: execution.outputs,
    logs: execution.logs,
    error: execution.error,
    events: execution.events.map(runtimeEventFromRunEvent),
  };
}

function runtimeEventFromRunEvent(event: RunEvent): NodeRuntimeEvent {
  return {
    type: event.type,
    timestamp: event.timestamp,
    scope: event.scope ?? [],
    attempt: readAttempt(event.payload),
    nextAttempt: readAttemptValue(event.payload.next_attempt),
    delayMs: readNumber(event.payload.delay_ms),
    mode: typeof event.payload.mode === "string" ? event.payload.mode : undefined,
    inputs: event.payload.inputs,
    outputs: event.payload.outputs,
    logs: event.payload.logs,
    error: event.payload.error,
    durationMs: readDurationMs(event.payload),
  };
}

function readAttempt(payload: Record<string, unknown>): number | undefined {
  return readAttemptValue(payload.attempt);
}

function readAttemptValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readDurationMs(payload: Record<string, unknown>): number | undefined {
  const value = payload.duration_ms;
  return typeof value === "number" ? value : undefined;
}

function connectionValues(outputs: NodeExecution["outputs"]): Record<string, unknown> | undefined {
  const entries = Object.entries(outputs);
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries.map(([name, connection]) => [name, connection.value]));
}

function addScope(scopes: string[][], scope: string[]): string[][] {
  if (scopes.some((currentScope) => areScopesEqual(currentScope, scope))) {
    return scopes;
  }

  return [...scopes, [...scope]];
}

function areScopesEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
