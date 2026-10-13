import type { Node } from "@xyflow/react";

/** Retain renderer measurements and active drag state during presentation updates. */
export function reconcileCanvasNodes<NodeType extends Node>(previous: NodeType[], documentNodes: NodeType[]): NodeType[] {
  const byId = new Map(previous.map((node) => [node.id, node]));
  return documentNodes.map((node) => {
    const current = byId.get(node.id);
    if (!current) return node;
    // React Flow hides an unmeasured node. Hover/selection updates must not reset
    // these dimensions; ResizeObserver still updates them when the card resizes.
    return {
      ...node,
      measured: node.measured ?? current.measured,
      ...(current.dragging ? { position: current.position, dragging: true } : {}),
    };
  });
}
