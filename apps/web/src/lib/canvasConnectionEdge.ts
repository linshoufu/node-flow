import { buildCanvasConnectionRuntime } from "./canvasConnectionRuntime";
import { resolveNodeInputPorts, resolveNodeOutputPorts } from "./nodePorts";
import type { NodeRunDetail } from "./nodeRunDetail";
import { portDisplayName } from "./schemaDisplay";
import type { NodeRunStatus } from "./runState";
import type { NodeType, WorkflowDocument, WorkflowEdge } from "../types";

export type CanvasConnectionEndpoint = {
  displayName: string;
  handle: string;
  nodeId: string;
};

export type CanvasConnectionEdgeData = {
  itemCount?: number;
  source: CanvasConnectionEndpoint;
  status?: NodeRunStatus;
  target: CanvasConnectionEndpoint;
};

export type CanvasConnectionEdge = {
  className?: string;
  data: CanvasConnectionEdgeData;
  id: string;
  label?: string;
  selected: boolean;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
};

export function buildCanvasConnectionEdge({
  edge,
  nodeRunDetails,
  nodeTypes,
  selected,
  workflow,
}: {
  edge: WorkflowEdge;
  nodeRunDetails: Record<string, NodeRunDetail>;
  nodeTypes: NodeType[];
  selected: boolean;
  workflow: WorkflowDocument;
}): CanvasConnectionEdge {
  const runtime = buildCanvasConnectionRuntime(edge, nodeRunDetails);
  const sourceEndpoint = connectionEndpoint({
    direction: "output",
    handle: edge.sourceHandle,
    nodeId: edge.source,
    nodeTypes,
    workflow,
  });
  const targetEndpoint = connectionEndpoint({
    direction: "input",
    handle: edge.targetHandle,
    nodeId: edge.target,
    nodeTypes,
    workflow,
  });
  const label = connectionLabel(sourceEndpoint, targetEndpoint, { runtimeLabel: runtime?.label, selected });

  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    selected,
    ...(runtime
      ? {
          className: runtime.className,
        }
      : {}),
    ...(label ? { label } : {}),
    data: {
      ...(runtime?.data ?? {}),
      source: sourceEndpoint,
      target: targetEndpoint,
    },
  };
}

function connectionLabel(
  source: CanvasConnectionEndpoint,
  target: CanvasConnectionEndpoint,
  { runtimeLabel, selected }: { runtimeLabel?: string; selected: boolean }
): string | undefined {
  const contractLabel = `${source.displayName} → ${target.displayName}`;

  if (selected && runtimeLabel) {
    return `${contractLabel} · ${runtimeLabel}`;
  }

  if (selected) {
    return contractLabel;
  }

  return runtimeLabel;
}

function connectionEndpoint({
  direction,
  handle,
  nodeId,
  nodeTypes,
  workflow,
}: {
  direction: "input" | "output";
  handle: string;
  nodeId: string;
  nodeTypes: NodeType[];
  workflow: WorkflowDocument;
}): CanvasConnectionEndpoint {
  const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
  const nodeType = nodeTypes.find((candidate) => candidate.id === node?.type);
  const port = !node || !nodeType
    ? undefined
    : direction === "input"
      ? resolveNodeInputPorts(node, nodeType)[handle]
      : resolveNodeOutputPorts(node, nodeType)[handle];

  return {
    displayName: port ? portDisplayName(handle, port) : handle,
    handle,
    nodeId,
  };
}
