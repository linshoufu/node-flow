import type { RunRecord, RunStatus } from "../types";
import { translateRunStatus } from "./display";

export type RunDrawerState = {
  expanded: boolean;
  manuallyPinned: boolean;
};

export type RunDrawerEvent =
  | { type: "toggle" }
  | { type: "run-updated"; status: RunStatus | null; hasError: boolean }
  | { type: "reset" };

export const initialRunDrawerState: RunDrawerState = {
  expanded: false,
  manuallyPinned: false,
};

export function reduceRunDrawer(
  state: RunDrawerState,
  event: RunDrawerEvent,
): RunDrawerState {
  if (event.type === "reset") {
    return initialRunDrawerState;
  }

  if (event.type === "toggle") {
    return {
      expanded: !state.expanded,
      manuallyPinned: true,
    };
  }

  if (state.manuallyPinned) {
    return state;
  }

  const shouldOpen =
    event.hasError ||
    event.status === "queued" ||
    event.status === "running" ||
    event.status === "failed" ||
    event.status === "cancelled";

  return shouldOpen ? { expanded: true, manuallyPinned: false } : state;
}

export function runDrawerSummary(run: RunRecord | null): {
  statusLabel: string;
  detail: string;
} {
  if (!run) {
    return {
      statusLabel: "空闲",
      detail: "暂无运行结果",
    };
  }

  return {
    statusLabel: translateRunStatus(run.status),
    detail: "本次运行",
  };
}
