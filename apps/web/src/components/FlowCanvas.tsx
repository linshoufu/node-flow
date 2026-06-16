import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { useCallback, useMemo } from "react";
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

      if (positionChanges.size === 0) {
        return;
      }

      onWorkflowChange({
        ...workflow,
        nodes: workflow.nodes.map((node) => {
          const position = positionChanges.get(node.id);
          return position ? { ...node, position } : node;
        }),
      });
    },
    [onWorkflowChange, workflow]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
        return;
      }

      const nextEdge: WorkflowEdge = {
        id: `edge_${connection.source}_${connection.sourceHandle}_${connection.target}_${connection.targetHandle}_${Date.now()}`,
        source: connection.source,
        sourceHandle: connection.sourceHandle,
        target: connection.target,
        targetHandle: connection.targetHandle,
      };

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
        edges={edges}
        fitView
        nodes={nodes}
        nodeTypes={flowNodeTypes}
        onConnect={handleConnect}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onNodesChange={handleNodesChange}
        onPaneClick={() => onSelectNode(null)}
        onSelectionChange={({ nodes: selectedNodes }) => onSelectNode(selectedNodes[0]?.id ?? null)}
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
