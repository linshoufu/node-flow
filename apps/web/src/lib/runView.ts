import type { RunEvent, RunRecord, RunStatus } from "../types";
import { buildExecutionData } from "./executionData";

export type RunViewMode = "empty" | "current" | "history";

export type RunViewState = {
  mode: RunViewMode;
  run: RunRecord | null;
  events: RunEvent[];
};

export type RunViewExecutionSummary = {
  nodeCount: number;
  executionCount: number;
  eventCount: number;
  failedExecutionCount: number;
  inputItemCount: number;
  outputItemCount: number;
};

const TERMINAL_RUN_STATUSES = new Set<RunStatus>(["succeeded", "failed", "cancelled"]);

export function emptyRunView(): RunViewState {
  return {
    mode: "empty",
    run: null,
    events: [],
  };
}

export function currentRunView(run: RunRecord, events: RunEvent[]): RunViewState {
  return {
    mode: "current",
    run,
    events,
  };
}

export function historicalRunView(run: RunRecord, events: RunEvent[]): RunViewState {
  return {
    mode: "history",
    run,
    events,
  };
}

export function runViewWithEvents(view: RunViewState, events: RunEvent[]): RunViewState {
  if (!view.run) {
    return emptyRunView();
  }

  return {
    ...view,
    events,
  };
}

export function runViewWithCurrentRun(view: RunViewState, run: RunRecord): RunViewState {
  return currentRunView(run, view.events);
}

export function runViewExecutionSummary(view: RunViewState): RunViewExecutionSummary {
  const executionData = buildExecutionData(view.events);
  const summaries = Object.values(executionData.nodeSummaries);
  const executionCount = Object.values(executionData.nodeRuns).reduce((count, runs) => count + runs.length, 0);

  return {
    nodeCount: executionData.nodeOrder.length,
    executionCount,
    eventCount: view.events.length,
    failedExecutionCount: summaries.reduce((count, summary) => count + summary.errorCount, 0),
    inputItemCount: summaries.reduce((count, summary) => count + summary.inputItemCount, 0),
    outputItemCount: summaries.reduce((count, summary) => count + summary.outputItemCount, 0),
  };
}

export function isHistoricalRunView(view: RunViewState): boolean {
  return view.mode === "history";
}

export function canCancelRunView(view: RunViewState): boolean {
  return view.mode === "current" && Boolean(view.run && !isTerminalRunStatus(view.run.status));
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}
