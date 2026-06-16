import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { useCallback, useMemo } from "react";
import { createWorkflowEdge } from "../lib/workflow";
import type { NodeType, WorkflowDocument, WorkflowEdge, WorkflowNode } from "../types";

type FlowCanvasProps = {
  workflow: WorkflowDocument;
  nodeTypes: NodeType[];
  selectedNodeId: string | null;
  onWorkflowChange: (workflow: WorkflowDocument) => void;
  onSelectNode: (nodeId: string | null) => void;
};

type EditorNodeData = {
  workflowNode: WorkflowNode;
  nodeType?: NodeType;
};

type EditorNode = Node<EditorNodeData, "workflowNode">;

const flowNodeTypes = {
  workflowNode: WorkflowNodeView,
};

export function FlowCanvas({
  workflow,
  nodeTypes,
  selectedNodeId,
  onWorkflowChange,
  onSelectNode,
}: FlowCanvasProps) {
  const nodeTypeById = useMemo(() => new Map(nodeTypes.map((nodeType) => [nodeType.id, nodeType])), [nodeTypes]);

  const nodes = useMemo<EditorNode[]>(
    () =>
      workflow.nodes.map((node) => ({
        id: node.id,
        type: "workflowNode",
        position: node.position,
        selected: node.id === selectedNodeId,
        data: {
          workflowNode: node,
          nodeType: nodeTypeById.get(node.type),
        },
      })),
    [nodeTypeById, selectedNodeId, workflow.nodes]
  );

  const edges = useMemo<Edge[]>(
    () =>
      workflow.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        markerEnd: { type: MarkerType.ArrowClosed },
      })),
    [workflow.edges]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<EditorNode>[]) => {
      const positionChanges = new Map(
        changes
          .filter(isPositionChange)
          .map((change) => [change.id, change.position])
      );
      const removedNodeIds = new Set(changes.filter(isNodeRemoveChange).map((change) => change.id));
      const nextSelectedNodeId = selectedNodeIdFromChanges(changes, selectedNodeId);

      if (positionChanges.size === 0 && removedNodeIds.size === 0) {
        if (nextSelectedNodeId !== selectedNodeId) {
          onSelectNode(nextSelectedNodeId);
        }
        return;
      }

      onWorkflowChange({
        ...workflow,
        nodes: workflow.nodes
          .filter((node) => !removedNodeIds.has(node.id))
          .map((node) => {
            const position = positionChanges.get(node.id);
            return position ? { ...node, position } : node;
          }),
        edges:
          removedNodeIds.size === 0
            ? workflow.edges
            : workflow.edges.filter(
                (edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target)
              ),
      });

      if (selectedNodeId && removedNodeIds.has(selectedNodeId)) {
        onSelectNode(null);
      } else if (nextSelectedNodeId !== selectedNodeId) {
        onSelectNode(nextSelectedNodeId);
      }
    },
    [onSelectNode, onWorkflowChange, selectedNodeId, workflow]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const removedEdgeIds = new Set(changes.filter(isEdgeRemoveChange).map((change) => change.id));

      if (removedEdgeIds.size === 0) {
        return;
      }

      onWorkflowChange({
        ...workflow,
        edges: workflow.edges.filter((edge) => !removedEdgeIds.has(edge.id)),
      });
    },
    [onWorkflowChange, workflow]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
        return;
      }

      const nextEdge: WorkflowEdge = createWorkflowEdge(
        connection.source,
        connection.sourceHandle,
        connection.target,
        connection.targetHandle
      );

      onWorkflowChange({
        ...workflow,
        edges: [...workflow.edges, nextEdge],
      });
    },
    [onWorkflowChange, workflow]
  );

  return (
    <section className="canvas-shell" aria-label="Canvas workspace">
      <ReactFlow
        deleteKeyCode={["Delete", "Backspace"]}
        edges={edges}
        fitView
        nodes={nodes}
        nodeTypes={flowNodeTypes}
        onConnect={handleConnect}
        onEdgesChange={handleEdgesChange}
        onNodesChange={handleNodesChange}
        onPaneClick={() => onSelectNode(null)}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </section>
  );
}

function isPositionChange(
  change: NodeChange<EditorNode>
): change is Extract<NodeChange<EditorNode>, { type: "position" }> & { position: { x: number; y: number } } {
  return change.type === "position" && Boolean(change.position);
}

function isNodeRemoveChange(
  change: NodeChange<EditorNode>
): change is Extract<NodeChange<EditorNode>, { type: "remove" }> {
  return change.type === "remove";
}

function isNodeSelectChange(
  change: NodeChange<EditorNode>
): change is Extract<NodeChange<EditorNode>, { type: "select" }> {
  return change.type === "select";
}

function selectedNodeIdFromChanges(changes: NodeChange<EditorNode>[], currentSelectedNodeId: string | null) {
  return changes.filter(isNodeSelectChange).reduce<string | null>((nextSelectedNodeId, change) => {
    if (change.selected) {
      return change.id;
    }

    return nextSelectedNodeId === change.id ? null : nextSelectedNodeId;
  }, currentSelectedNodeId);
}

function isEdgeRemoveChange(change: EdgeChange<Edge>): change is Extract<EdgeChange<Edge>, { type: "remove" }> {
  return change.type === "remove";
}

function WorkflowNodeView({ data, selected }: NodeProps<EditorNode>) {
  const { workflowNode, nodeType } = data;
  const inputs = Object.entries(nodeType?.inputs ?? {});
  const outputs = Object.entries(nodeType?.outputs ?? {});

  return (
    <div className={selected ? "flow-node is-selected" : "flow-node"}>
      <div className="flow-node-header">
        <strong>{nodeType?.name ?? workflowNode.type}</strong>
        <small>{workflowNode.id}</small>
      </div>
      {nodeType?.description ? <p>{nodeType.description}</p> : null}
      <PortHandles ports={inputs} side="input" />
      <PortHandles ports={outputs} side="output" />
    </div>
  );
}

type PortHandlesProps = {
  ports: Array<[string, unknown]>;
  side: "input" | "output";
};

function PortHandles({ ports, side }: PortHandlesProps) {
  const position = side === "input" ? Position.Left : Position.Right;
  const type = side === "input" ? "target" : "source";

  return (
    <>
      {ports.map(([portName], index) => (
        <Handle
          className="flow-handle"
          id={portName}
          key={portName}
          position={position}
          style={{ top: `${((index + 1) / (ports.length + 1)) * 100}%` }}
          title={portName}
          type={type}
        />
      ))}
    </>
  );
}
