import type { RunEvent, RunStatus, WorkflowNode } from "../types";

export type NodeRunStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";

export type NodeRuntimeState = {
  nodeId: string;
  status: NodeRunStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  inputs?: unknown;
  outputs?: unknown;
  error?: unknown;
  logs?: unknown;
  scopes: string[][];
};

export function buildNodeRunStates(
  nodes: WorkflowNode[],
  events: RunEvent[],
  runStatus?: RunStatus | "idle" | null
): Record<string, NodeRuntimeState> {
  const states: Record<string, NodeRuntimeState> = Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        nodeId: node.id,
        status: "pending" as const,
        scopes: [],
      },
    ])
  );

  for (const event of events) {
    if (!event.node_id || !states[event.node_id]) {
      continue;
    }

    const state = states[event.node_id];
    addScope(state, event.scope ?? []);

    if (event.type === "node_started") {
      state.status = "running";
      state.startedAt = event.timestamp;
      state.inputs = event.payload.inputs;
      continue;
    }

    if (event.type === "node_succeeded") {
      state.status = "succeeded";
      state.completedAt = event.timestamp;
      state.outputs = event.payload.outputs;
      state.logs = event.payload.logs;
      state.durationMs = readDurationMs(event.payload);
      continue;
    }

    if (event.type === "node_failed") {
      state.status = "failed";
      state.completedAt = event.timestamp;
      state.error = event.payload.error;
      state.logs = event.payload.logs;
      state.durationMs = readDurationMs(event.payload);
    }
  }

  if (runStatus === "cancelled") {
    for (const state of Object.values(states)) {
      if (state.status === "running") {
        state.status = "cancelled";
      } else if (state.status === "pending") {
        state.status = "skipped";
      }
    }
  }

  return states;
}

function readDurationMs(payload: Record<string, unknown>): number | undefined {
  const value = payload.duration_ms;
  return typeof value === "number" ? value : undefined;
}

function addScope(state: NodeRuntimeState, scope: string[]) {
  if (state.scopes.some((currentScope) => areScopesEqual(currentScope, scope))) {
    return;
  }

  state.scopes.push([...scope]);
}

function areScopesEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
