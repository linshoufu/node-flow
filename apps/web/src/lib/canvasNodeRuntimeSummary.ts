import { normalizeExecutionItems } from "./executionItems";
import type { NodeRunDetail } from "./nodeRunDetail";
import type { NodeRuntimeState } from "./runState";

export type CanvasNodeRuntimeBadge = {
  id: "executions" | "iterations" | "inputs" | "outputs" | "errors" | "duration";
  label: string;
  tone?: "danger" | "muted";
};

export type CanvasNodeRuntimeSummary = {
  badges: CanvasNodeRuntimeBadge[];
  ariaLabel: string;
};

export function buildCanvasNodeRuntimeSummary({
  runDetail,
  runtimeState,
}: {
  runDetail?: NodeRunDetail;
  runtimeState?: NodeRuntimeState;
}): CanvasNodeRuntimeSummary | null {
  const counters = runDetail?.hasData
    ? countersFromRunDetail(runDetail, runtimeState)
    : countersFromRuntimeState(runtimeState);

  if (!counters) {
    return null;
  }

  const badges: CanvasNodeRuntimeBadge[] = [
    counterBadge("executions", counters.runCount, "次执行"),
    counterBadge("iterations", counters.iterationCount, "轮循环"),
    counterBadge("inputs", counters.inputItemCount, "项输入"),
    counterBadge("outputs", counters.outputItemCount, "项输出"),
    counterBadge("errors", counters.errorCount, "个错误", "danger"),
    counters.durationMs !== undefined
      ? {
          id: "duration",
          label: `耗时 ${formatDuration(counters.durationMs)}`,
          tone: "muted",
        }
      : null,
  ].filter((badge): badge is CanvasNodeRuntimeBadge => Boolean(badge));

  return badges.length > 0
    ? {
        badges,
        ariaLabel: badges.map((badge) => badge.label).join("，"),
      }
    : null;
}

type RuntimeCounters = {
  runCount: number;
  iterationCount: number;
  inputItemCount: number;
  outputItemCount: number;
  errorCount: number;
  durationMs?: number;
};

function countersFromRunDetail(runDetail: NodeRunDetail, runtimeState?: NodeRuntimeState): RuntimeCounters {
  return {
    runCount: runDetail.executionCount,
    iterationCount: iterationCount(runtimeState),
    inputItemCount: runDetail.inputItemCount,
    outputItemCount: runDetail.outputItemCount,
    errorCount: runDetail.errorCount,
    durationMs: runDetail.latestDurationMs,
  };
}

function countersFromRuntimeState(runtimeState?: NodeRuntimeState): RuntimeCounters | null {
  if (!runtimeState || runtimeState.status === "pending") {
    return null;
  }

  const executions = runtimeState.executions ?? [];
  const runCount = executions.length > 0 ? executions.length : runtimeState.outputs === undefined ? 0 : 1;
  const inputItemCount =
    executions.length > 0
      ? executions.reduce(
          (count, execution) => count + (execution.inputItems?.length ?? inputItemCountFromRawInputs(execution.inputs)),
          0
        )
      : inputItemCountFromRawInputs(runtimeState.inputs);
  const outputItemCount =
    executions.length > 0
      ? executions.reduce(
          (count, execution) =>
            count + Object.values(execution.outputs).reduce((items, connection) => items + connection.items.length, 0),
          0
        )
      : outputItemCountFromRawOutputs(runtimeState.outputs);
  const errorCount =
    executions.length > 0
      ? executions.filter((execution) => execution.status === "failed" || execution.error !== undefined).length
      : runtimeState.status === "failed" || runtimeState.error !== undefined
        ? 1
        : 0;
  const durationMs = latestDurationMs(runtimeState);

  if (runCount === 0 && inputItemCount === 0 && outputItemCount === 0 && errorCount === 0 && durationMs === undefined) {
    return null;
  }

  return {
    runCount,
    iterationCount: iterationCount(runtimeState),
    inputItemCount,
    outputItemCount,
    errorCount,
    durationMs,
  };
}

function counterBadge(
  id: CanvasNodeRuntimeBadge["id"],
  value: number,
  unit: string,
  tone?: CanvasNodeRuntimeBadge["tone"]
): CanvasNodeRuntimeBadge | null {
  return value > 0 ? { id, label: `${value} ${unit}`, tone } : null;
}

function iterationCount(runtimeState?: NodeRuntimeState): number {
  const scopes = [
    ...(runtimeState?.scopes ?? []),
    ...((runtimeState?.executions ?? []).map((execution) => execution.scope)),
  ];
  const iterationKeys = new Set(
    scopes
      .map((scope) => scope.find((part) => part.startsWith("iteration:")))
      .filter((part): part is string => Boolean(part))
  );

  return iterationKeys.size;
}

function latestDurationMs(runtimeState: NodeRuntimeState): number | undefined {
  const executions = runtimeState.executions ?? [];
  const latestExecution = executions[executions.length - 1];
  return latestExecution?.durationMs ?? runtimeState.durationMs;
}

function inputItemCountFromRawInputs(inputs: unknown): number {
  return inputs === undefined ? 0 : normalizeExecutionItems(inputs).length;
}

function outputItemCountFromRawOutputs(outputs: unknown): number {
  if (!isRecord(outputs)) {
    return 0;
  }

  return Object.values(outputs).reduce<number>((count, value) => count + outputItemCountFromValue(value), 0);
}

function outputItemCountFromValue(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }

  return value === undefined || value === null ? 0 : 1;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }

  const seconds = durationMs / 1000;
  const rounded = seconds < 10 ? Number(seconds.toFixed(1)) : Math.round(seconds);
  return `${rounded} 秒`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
