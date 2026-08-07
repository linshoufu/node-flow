import type { RunRecord } from "../types";

// 运行终态通知总线：运行跟踪到达终态时发布，运行历史等订阅方据此自动刷新
export type RunTerminalListener = (run: RunRecord) => void;

const listeners = new Set<RunTerminalListener>();

export function onRunTerminal(listener: RunTerminalListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyRunTerminal(run: RunRecord): void {
  for (const listener of [...listeners]) {
    listener(run);
  }
}
