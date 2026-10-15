import type { NodeType, RunEvent, RunRecord, WorkflowDocument } from "@/types";
import type { NodeRunStatus } from "@/components/NodeCard";
import type { CanvasScopeSegment, WorkflowGraph } from "@/store/workflow";

export function nodeRunStatus(nodeId: string, nodeType: NodeType | undefined, run: RunRecord | null, events: RunEvent[]): NodeRunStatus | null {
  if (!run) return null;
  const latestEvent = events.filter((event) => event.node_id === nodeId).at(-1);
  const latest = latestEvent?.type ?? "";
  const outputs = latestEvent?.payload.outputs;
  if (outputs && typeof outputs === "object" && !Array.isArray(outputs) &&
    Object.keys(outputs).some((id) => nodeType?.outputs[id]?.category === "error")) return "failed";
  if (latest.includes("failed") || latest.includes("error")) return "failed";
  if (latest === "node_not_verified") return "unverified";
  if (latest === "node_succeeded" && latestEvent?.payload.run_mode === "preview" && events.some((event) => event.node_id === nodeId && event.type === "node_previewed" && Array.isArray(event.payload.effects) && event.payload.effects.length > 0)) return "planned";
  if (latest.includes("succeeded") || latest.includes("pinned_data_used")) return "succeeded";
  if (latest.includes("skipped") || latest.includes("disabled")) return "skipped";
  if (latest.includes("started")) return "running";
  return ["queued", "running"].includes(run.status) ? "waiting" : null;
}

export function findRunNodeScope(workflow: WorkflowDocument, nodeId: string, eventScope: string[] = []): CanvasScopeSegment[] | null {
  const candidates: CanvasScopeSegment[][] = [];
  const visit = (graph: WorkflowGraph, path: CanvasScopeSegment[]) => {
    if (graph.nodes.some((node) => node.id === nodeId)) candidates.push(path);
    for (const node of graph.nodes) for (const [key, flow] of Object.entries(node.subflows ?? {}))
      visit(flow, [...path, { nodeId: node.id, key, label: node.label || node.type }]);
  };
  visit(workflow, []);
  return candidates.find((path) => path.length === eventScope.filter((part) => !part.startsWith("iteration:")).length &&
    path.every((part) => eventScope.includes(part.nodeId))) ?? candidates[0] ?? null;
}
