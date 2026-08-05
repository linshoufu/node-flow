import type { NodeRunStatus } from "../lib/runState";
import type { NodeRuntimeNavigationTarget } from "../lib/nodeRuntimeNavigation";

export type NodeSelectionTarget = NodeRuntimeNavigationTarget;

export const nodeStatusLabels: Record<NodeRunStatus, string> = {
  pending: "等待",
  running: "运行中",
  succeeded: "成功",
  failed: "失败",
  handled: "已处理",
  skipped: "跳过",
  cancelled: "已取消",
};

export function nodeDisplayName(nodeId: string, nodeDisplayNames: Record<string, string>): string {
  return nodeDisplayNames[nodeId] ?? nodeId;
}

export function formatDuration(durationMs: number): string {
  return `${Math.round(durationMs)} ms`;
}

export function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    const text = JSON.stringify(value);
    if (!text) {
      return String(value);
    }

    return text.length > 240 ? `${text.slice(0, 240)}...` : text;
  } catch {
    return String(value);
  }
}

export function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
}

export function ExecutionJsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="execution-json-block">
      <strong>{title}</strong>
      <code>{formatValue(value)}</code>
    </div>
  );
}
