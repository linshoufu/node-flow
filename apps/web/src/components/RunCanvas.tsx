import { useEffect, useMemo, useRef, useState } from "react";
import { applyNodeChanges, Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import { ArrowLeft, GitBranch, LockKeyhole } from "lucide-react";
import { apiClient } from "@/api/client";
import { getActiveGraph, useWorkflowStore, type CanvasScopeSegment } from "@/store/workflow";
import type { NodeFormManifest, NodeType, RunEvent, RunRecord, WorkflowDocument, WorkflowNode } from "@/types";
import { findRunNodeScope, nodeRunStatus } from "@/lib/runCanvas";
import { reconcileCanvasNodes } from "@/lib/canvasNodes";
import { NodeCard, NODE_HANDLE_CLASS, type NodeRunStatus } from "./NodeCard";

type Selection = { nodeId: string; scope: string[] } | null;
type Data = { node: WorkflowNode; nodeType?: NodeType; manifest?: NodeFormManifest; status: NodeRunStatus | null;
  connected: string[]; onOpen: (node: WorkflowNode) => void };

function SnapshotNode({ data, selected }: NodeProps<Node<Data>>) {
  return <NodeCard node={data.node} nodeType={data.nodeType} manifest={data.manifest} selected={selected} readOnly
    connectedOutputHandles={data.connected} runStatus={data.status} onOpenSubflow={data.onOpen}
    renderHandle={(direction, id, port, color) => <Handle isConnectable={false} type={direction === "input" ? "target" : "source"}
      position={direction === "input" ? Position.Left : Position.Right} id={id} style={{ background: color }} className={NODE_HANDLE_CLASS} title={port.displayName ?? id} />} />;
}
const renderers = { snapshot: SnapshotNode };

export function RunCanvas(props: { workflow: WorkflowDocument; run: RunRecord; events: RunEvent[]; selection: Selection;
  onSelectNode: (nodeId: string, scope: string[]) => void }) {
  return <ReactFlowProvider><SnapshotCanvas {...props} /></ReactFlowProvider>;
}

function SnapshotCanvas({ workflow, run, events, selection, onSelectNode }: Parameters<typeof RunCanvas>[0]) {
  const catalog = useWorkflowStore((state) => state.nodeTypes);
  const [scope, setScope] = useState<CanvasScopeSegment[]>([]);
  const [manifests, setManifests] = useState<Record<string, NodeFormManifest>>({});
  const [canvasNodes, setCanvasNodes] = useState<Node<Data>[]>([]);
  const viewportHost = useRef<HTMLElement>(null);
  const instance = useRef<ReactFlowInstance<Node<Data>, Edge> | null>(null);
  const types = useMemo(() => new Map(catalog.map((type) => [type.id, type])), [catalog]);
  const graph = useMemo(() => getActiveGraph(workflow, scope), [workflow, scope]);
  useEffect(() => {
    let previous: { width: number; height: number } | null = null;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const flow = instance.current;
      if (previous && flow?.viewportInitialized && width > 0 && height > 0) {
        const viewport = flow.getViewport();
        void flow.setViewport({ ...viewport, x: viewport.x + (width - previous.width) / 2, y: viewport.y + (height - previous.height) / 2 });
      }
      previous = { width, height };
    });
    if (viewportHost.current) observer.observe(viewportHost.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!selection) return;
    const path = findRunNodeScope(workflow, selection.nodeId, selection.scope);
    if (path) setScope(path);
  }, [selection, workflow]);
  useEffect(() => {
    let disposed = false;
    void Promise.all(catalog.map(async (type) => {
      try { return [type.id, await apiClient.getNodeTypeManifest(type.id)] as const; }
      catch { return [type.id, { version: 1 }] as const; }
    })).then((entries) => { if (!disposed) setManifests(Object.fromEntries(entries)); });
    return () => { disposed = true; };
  }, [catalog]);
  const scopeIds = useMemo(() => scope.map((part) => part.nodeId), [scope]);
  const scopedEvents = useMemo(() => events.filter((event) => {
    const parents = event.scope.filter((part) => !part.startsWith("iteration:"));
    return parents.length === scopeIds.length && parents.every((id, index) => id === scopeIds[index]);
  }), [events, scopeIds]);
  const nodes = useMemo<Node<Data>[]>(() => graph.nodes.map((node) => ({ id: node.id, type: "snapshot", position: node.position,
    selected: selection?.nodeId === node.id,
    data: { node, nodeType: types.get(node.type), manifest: manifests[node.type],
      status: nodeRunStatus(node.id, types.get(node.type), run, scopedEvents),
      connected: graph.edges.filter((edge) => edge.source === node.id).map((edge) => edge.sourceHandle),
      onOpen: (owner) => setScope((current) => [...current, { nodeId: owner.id, key: "body", label: owner.label || "循环体" }]),
    } })), [graph, types, manifests, run, scopedEvents, selection]);
  // Retain React Flow measurements across polling and node selection updates.
  useEffect(() => { setCanvasNodes((previous) => reconcileCanvasNodes(previous, nodes) as Node<Data>[]); }, [nodes]);
  const executed = new Set(scopedEvents.filter((event) => ["node_succeeded", "node_error_handled", "node_pinned_data_used"].includes(event.type)).map((event) => event.node_id));
  const edges: Edge[] = graph.edges.map((edge) => {
    const traversed = scopedEvents.some((event) => event.node_id === edge.source && event.payload.outputs &&
      typeof event.payload.outputs === "object" && Object.prototype.hasOwnProperty.call(event.payload.outputs, edge.sourceHandle));
    return { ...edge, type: "bezier", style: { stroke: traversed && executed.has(edge.target) ? "#34d399" : "#526176", strokeWidth: traversed ? 2.5 : 1.5 } };
  });
  return <section ref={viewportHost} aria-label="只读运行画布" className="relative h-full min-h-[260px] overflow-hidden rounded-xl border border-border/60 bg-canvas">
    <ReactFlow key={`${run.id}:${scope.map((part) => part.nodeId).join("/")}`} nodes={canvasNodes} edges={edges} nodeTypes={renderers}
      nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}
      onInit={(flow) => { instance.current = flow; }}
      onNodesChange={(changes) => setCanvasNodes((current) => applyNodeChanges(changes.filter((change) => change.type === "dimensions"), current))}
      onNodeClick={(_, node) => onSelectNode(node.id, scopeIds)} fitView fitViewOptions={{ padding: 0.18 }} minZoom={0.15} maxZoom={2}>
      <Background gap={20} size={1} color="#273244" />
      <Controls showInteractive={false} />
    </ReactFlow>
    <div className="glass-island absolute left-3 top-3 z-10 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-lg px-3 py-2 text-xs">
      {scope.length ? <><button type="button" aria-label="返回上一级运行画布" onClick={() => setScope((current) => current.slice(0, -1))} className="rounded p-1 hover:bg-raised"><ArrowLeft size={14} /></button><GitBranch size={14} /><span>{scope.at(-1)?.label}</span></> : <><LockKeyhole size={13} className="text-primary" /><span>运行时快照 · v{run.workflow_version}</span></>}
      <span className="text-[10px] text-muted">只读</span>
    </div>
  </section>;
}
