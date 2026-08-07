import { useMemo } from "react";
import { buildCanvasNodeData } from "../lib/canvasNodeData";
import type { NodeFormGroup, NodeType, WorkflowNode } from "../types";
import { NodeVisualCard } from "./FlowCanvas";

type Props = {
  nodeType: NodeType;
  groups: NodeFormGroup[];
  defaults?: Record<string, unknown>;
  selectedField?: string | null;
  onSelectField?: (fieldKey: string) => void;
};

/**
 * The editor preview deliberately uses the same card component as the workflow
 * canvas. This prevents the definition editor from drifting into a second,
 * misleading visual language.
 */
export function NodePortsPreview({ nodeType, groups, defaults = {} }: Props) {
  // Keep the preview on the editor's draft form instead of the last saved
  // catalog form, while continuing to reuse the real workflow node card.
  const previewNodeType = useMemo<NodeType>(
    () => ({ ...nodeType, form: { groups } }),
    [groups, nodeType],
  );
  const previewNode = useMemo<WorkflowNode>(() => ({
    id: "__node_definition_preview__",
    type: previewNodeType.id,
    label: "",
    position: { x: 0, y: 0 },
    config: defaults,
  }), [defaults, previewNodeType.id]);
  const canvasNode = useMemo(
    () => buildCanvasNodeData({ node: previewNode, nodeType: previewNodeType }),
    [previewNode, previewNodeType],
  );

  return (
    <NodeVisualCard
      canvasNode={canvasNode}
      className="editor-node-preview"
      interactivePorts={false}
      nodeType={previewNodeType}
      workflowNode={previewNode}
    />
  );
}
