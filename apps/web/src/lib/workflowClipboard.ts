import type { WorkflowEdge, WorkflowNode } from "../types";
import { duplicateWorkflowNodes } from "./workflow";

export type WorkflowNodeClipboard = {
  format: "node-flow.nodes";
  version: 1;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export function createWorkflowNodeClipboard(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  selectedNodeIds: Iterable<string>
): WorkflowNodeClipboard {
  const selectedIds = new Set(selectedNodeIds);
  const selectedNodes = nodes.filter((node) => selectedIds.has(node.id));
  const copiedIds = new Set(selectedNodes.map((node) => node.id));

  return {
    format: "node-flow.nodes",
    version: 1,
    nodes: cloneValue(selectedNodes),
    edges: cloneValue(edges.filter((edge) => copiedIds.has(edge.source) && copiedIds.has(edge.target))),
  };
}

export function pasteWorkflowNodeClipboard(
  clipboard: WorkflowNodeClipboard,
  offset: { x: number; y: number } = { x: 48, y: 36 }
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  return duplicateWorkflowNodes(clipboard.nodes, clipboard.edges, clipboard.nodes.map((node) => node.id), offset);
}

export function serializeWorkflowNodeClipboard(clipboard: WorkflowNodeClipboard): string {
  return JSON.stringify(clipboard);
}

export function parseWorkflowNodeClipboard(value: string): WorkflowNodeClipboard | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isWorkflowNodeClipboard(parsed)) {
      return null;
    }
    return cloneValue(parsed);
  } catch {
    return null;
  }
}

function isWorkflowNodeClipboard(value: unknown): value is WorkflowNodeClipboard {
  if (!isRecord(value) || value.format !== "node-flow.nodes" || value.version !== 1) {
    return false;
  }
  return Array.isArray(value.nodes) && value.nodes.every(isWorkflowNode) && Array.isArray(value.edges) && value.edges.every(isWorkflowEdge);
}

function isWorkflowNode(value: unknown): value is WorkflowNode {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.type === "string" &&
    value.type.trim().length > 0 &&
    isPosition(value.position) &&
    isRecord(value.config)
  );
}

function isWorkflowEdge(value: unknown): value is WorkflowEdge {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.source === "string" &&
    typeof value.sourceHandle === "string" &&
    typeof value.target === "string" &&
    typeof value.targetHandle === "string"
  );
}

function isPosition(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue<Value>(value: Value): Value {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as Value;
}
