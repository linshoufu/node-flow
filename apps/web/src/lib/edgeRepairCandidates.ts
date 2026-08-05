import type { NodeType, WorkflowDocument, WorkflowEdge } from "../types";
import { validateConnection } from "./connectionValidation";
import { resolveNodeInputPorts } from "./nodePorts";
import { portDisplayName } from "./schemaDisplay";

export type EdgeRepairCandidate = {
  handle: string;
  label: string;
};

export function buildEdgeRepairCandidates(
  edge: WorkflowEdge,
  workflow: WorkflowDocument,
  nodeTypes: NodeType[]
): EdgeRepairCandidate[] {
  const targetNode = workflow.nodes.find((node) => node.id === edge.target);
  const targetType = targetNode ? nodeTypes.find((nodeType) => nodeType.id === targetNode.type) : undefined;
  if (!targetNode || !targetType) {
    return [];
  }

  const workflowWithoutCurrentEdge = {
    ...workflow,
    edges: workflow.edges.filter((workflowEdge) => workflowEdge.id !== edge.id),
  };

  return Object.entries(resolveNodeInputPorts(targetNode, targetType))
    .filter(([handle]) => handle !== edge.targetHandle)
    .filter(([handle]) =>
      validateConnection(
        {
          source: edge.source,
          sourceHandle: edge.sourceHandle,
          target: edge.target,
          targetHandle: handle,
        },
        workflowWithoutCurrentEdge,
        nodeTypes
      ).valid
    )
    .map(([handle, port]) => ({
      handle,
      label: portDisplayName(handle, port),
    }));
}
