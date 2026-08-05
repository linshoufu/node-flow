import { buildExecutionData, latestNodeExecution, type NodeExecutionSummary } from "./executionData";
import type { RunEvent } from "../types";

export type RunComparisonChange = "unchanged" | "changed" | "added" | "removed";

export type RunComparisonNode = {
  nodeId: string;
  change: RunComparisonChange;
  baseline: NodeExecutionSummary | null;
  current: NodeExecutionSummary | null;
  inputChanged: boolean;
  outputChanged: boolean;
};

export type RunComparison = {
  nodeCount: number;
  changedNodeCount: number;
  unchangedNodeCount: number;
  nodes: RunComparisonNode[];
};

export function buildRunComparison(baselineEvents: RunEvent[], currentEvents: RunEvent[]): RunComparison {
  const baselineData = buildExecutionData(baselineEvents);
  const currentData = buildExecutionData(currentEvents);
  const nodeIds = [...baselineData.nodeOrder, ...currentData.nodeOrder.filter((nodeId) => !baselineData.nodeRuns[nodeId])];
  const nodes = nodeIds.map((nodeId) => {
    const baseline = baselineData.nodeSummaries[nodeId] ?? null;
    const current = currentData.nodeSummaries[nodeId] ?? null;
    const inputChanged = executionInputChanged(baselineData, currentData, nodeId);
    const outputChanged = executionOutputChanged(baselineData, currentData, nodeId);
    const change = nodeChange(baseline, current, inputChanged, outputChanged);

    return { nodeId, change, baseline, current, inputChanged, outputChanged };
  });
  const changedNodeCount = nodes.filter((node) => node.change !== "unchanged").length;

  return {
    nodeCount: nodes.length,
    changedNodeCount,
    unchangedNodeCount: nodes.length - changedNodeCount,
    nodes,
  };
}

function nodeChange(
  baseline: NodeExecutionSummary | null,
  current: NodeExecutionSummary | null,
  inputChanged: boolean,
  outputChanged: boolean
): RunComparisonChange {
  if (!baseline) {
    return "added";
  }
  if (!current) {
    return "removed";
  }
  if (
    baseline.latestStatus !== current.latestStatus ||
    baseline.runCount !== current.runCount ||
    baseline.inputItemCount !== current.inputItemCount ||
    baseline.outputItemCount !== current.outputItemCount ||
    baseline.errorCount !== current.errorCount ||
    inputChanged ||
    outputChanged
  ) {
    return "changed";
  }
  return "unchanged";
}

function executionInputChanged(
  baselineData: ReturnType<typeof buildExecutionData>,
  currentData: ReturnType<typeof buildExecutionData>,
  nodeId: string
): boolean {
  return stableValue(latestNodeExecution(baselineData, nodeId)?.inputs) !== stableValue(latestNodeExecution(currentData, nodeId)?.inputs);
}

function executionOutputChanged(
  baselineData: ReturnType<typeof buildExecutionData>,
  currentData: ReturnType<typeof buildExecutionData>,
  nodeId: string
): boolean {
  const baseline = latestNodeExecution(baselineData, nodeId);
  const current = latestNodeExecution(currentData, nodeId);
  return stableValue(baseline?.outputs) !== stableValue(current?.outputs);
}

function stableValue(value: unknown): string {
  return JSON.stringify(value, objectKeySorter) ?? "undefined";
}

function objectKeySorter(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}
