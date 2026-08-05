import type { WorkflowDocument, WorkflowEdge, WorkflowNode } from "../types";

export type WorkflowVersionDiff = {
  baselineVersion: number;
  currentVersion: number;
  changed: boolean;
  addedNodeIds: string[];
  removedNodeIds: string[];
  changedNodeIds: string[];
  movedNodeIds: string[];
  addedEdgeCount: number;
  removedEdgeCount: number;
  metadataChanged: boolean;
  settingsChanged: boolean;
  annotationsChanged: boolean;
};

export function buildWorkflowVersionDiff(
  baseline: WorkflowDocument,
  current: WorkflowDocument
): WorkflowVersionDiff {
  const baselineNodes = new Map(baseline.nodes.map((node) => [node.id, node]));
  const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));
  const addedNodeIds = current.nodes.filter((node) => !baselineNodes.has(node.id)).map((node) => node.id);
  const removedNodeIds = baseline.nodes.filter((node) => !currentNodes.has(node.id)).map((node) => node.id);
  const sharedNodeIds = baseline.nodes.map((node) => node.id).filter((nodeId) => currentNodes.has(nodeId));
  const changedNodeIds = sharedNodeIds.filter(
    (nodeId) => !sameValue(nodeContent(baselineNodes.get(nodeId) as WorkflowNode), nodeContent(currentNodes.get(nodeId) as WorkflowNode))
  );
  const movedNodeIds = sharedNodeIds.filter((nodeId) => {
    const before = baselineNodes.get(nodeId) as WorkflowNode;
    const after = currentNodes.get(nodeId) as WorkflowNode;
    return before.position.x !== after.position.x || before.position.y !== after.position.y;
  });
  const baselineEdges = new Set(baseline.edges.map(edgeKey));
  const currentEdges = new Set(current.edges.map(edgeKey));
  const addedEdgeCount = [...currentEdges].filter((edge) => !baselineEdges.has(edge)).length;
  const removedEdgeCount = [...baselineEdges].filter((edge) => !currentEdges.has(edge)).length;
  const metadataChanged = !sameValue(workflowMetadata(baseline), workflowMetadata(current));
  const settingsChanged = !sameValue(baseline.settings, current.settings);
  const annotationsChanged = !sameValue(baseline.annotations ?? [], current.annotations ?? []);
  const changed =
    addedNodeIds.length > 0 ||
    removedNodeIds.length > 0 ||
    changedNodeIds.length > 0 ||
    movedNodeIds.length > 0 ||
    addedEdgeCount > 0 ||
    removedEdgeCount > 0 ||
    metadataChanged ||
    settingsChanged ||
    annotationsChanged;

  return {
    baselineVersion: baseline.version,
    currentVersion: current.version,
    changed,
    addedNodeIds,
    removedNodeIds,
    changedNodeIds,
    movedNodeIds,
    addedEdgeCount,
    removedEdgeCount,
    metadataChanged,
    settingsChanged,
    annotationsChanged,
  };
}

function workflowMetadata(workflow: WorkflowDocument) {
  return {
    name: workflow.name,
    active: workflow.active ?? false,
    description: workflow.description ?? "",
    tags: [...(workflow.tags ?? [])].sort(),
  };
}

function nodeContent(node: WorkflowNode): Omit<WorkflowNode, "position"> {
  const { position: _position, ...content } = node;
  return content;
}

function edgeKey(edge: WorkflowEdge): string {
  return stableValue(edge);
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableValue(left) === stableValue(right);
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
