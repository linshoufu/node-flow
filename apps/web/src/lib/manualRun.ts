import type { NodeType, WorkflowDocument, WorkflowNode } from "../types";
import { resolveNodeInputPorts } from "./nodePorts";

type WorkflowGraph = Pick<WorkflowDocument, "nodes" | "edges">;

export function manualRunUnavailableReason(
  node: WorkflowNode | undefined,
  nodeType: NodeType | undefined,
  workflow: WorkflowGraph
): string | undefined {
  if (!node || !nodeType) {
    return undefined;
  }

  const nodeById = new Map(workflow.nodes.map((workflowNode) => [workflowNode.id, workflowNode]));
  const pinnedInputHandles = new Set(
    workflow.edges
      .filter((edge) => edge.target === node.id)
      .filter((edge) => {
        const sourceNode = nodeById.get(edge.source);
        return Boolean(sourceNode?.pinnedData && edge.sourceHandle in sourceNode.pinnedData);
      })
      .map((edge) => edge.targetHandle)
  );
  const requiredInputs = Object.entries(resolveNodeInputPorts(node, nodeType))
    .filter(([name, input]) => input.required && !pinnedInputHandles.has(name))
    .map(([name, input]) => input.displayName || name);
  if (requiredInputs.length === 0) {
    return undefined;
  }
  const labels = requiredInputs.map((label) => `“${label}”`).join("、");
  return `此节点需要${labels}输入；请使用完整运行。`;
}
