import type { NodeType, WorkflowDocument, WorkflowNode } from "../types";

export function buildNodeDisplayNames(
  workflow: Pick<WorkflowDocument, "nodes">,
  nodeTypes: NodeType[]
): Record<string, string> {
  const nodeTypeById = new Map(nodeTypes.map((nodeType) => [nodeType.id, nodeType]));

  return Object.fromEntries(
    workflow.nodes.map((node) => [node.id, workflowNodeDisplayName(node, nodeTypeById.get(node.type))])
  );
}

export function workflowNodeDisplayName(node: WorkflowNode, nodeType?: NodeType): string {
  return node.label?.trim() || configuredNodeName(node.config) || nodeType?.displayName || nodeType?.name || node.id;
}

function configuredNodeName(config: Record<string, unknown>): string | null {
  for (const key of ["label", "title", "name"]) {
    const value = config[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}
