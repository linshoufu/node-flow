import { useCallback, useEffect, useMemo, memo, useRef, useState } from "react";
import {
  Background,
  ConnectionLineType,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowInstance,
  ReactFlowProvider,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { ArrowLeft, Crosshair, GitBranch, Map as MapIcon, MousePointer2, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { apiClient } from "@/api/client";
import { getActiveGraph, useWorkflowStore } from "@/store/workflow";
import type { HttpProfile, NodeFormManifest, NodeType, RunEvent, RunRecord, WorkflowNode as WorkflowNodeDocument } from "@/types";
import { toast } from "./Toaster";
import { NodeCard, NODE_HANDLE_CLASS, type NodeRunStatus } from "./NodeCard";
import { categoryColor, categoryName, nodeDescription, nodeName } from "@/lib/nodePresentation";
import { reconcileCanvasNodes } from "@/lib/canvasNodes";

export function FlowCanvas() {
  return <ReactFlowProvider><FlowCanvasInner /></ReactFlowProvider>;
}

function FlowCanvasInner() {
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const canvasScope = useWorkflowStore((s) => s.canvasScope);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const enterSubflow = useWorkflowStore((s) => s.enterSubflow);
  const exitSubflow = useWorkflowStore((s) => s.exitSubflow);
  const addNode = useWorkflowStore((s) => s.addNode);
  const updateNodePosition = useWorkflowStore((s) => s.updateNodePosition);
  const addEdge = useWorkflowStore((s) => s.addEdge);
  const deleteNode = useWorkflowStore((s) => s.deleteNode);
  const deleteEdge = useWorkflowStore((s) => s.deleteEdge);
  const [showMap, setShowMap] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [canvasNodes, setCanvasNodes] = useState<Node[]>([]);
  const [quickAdd, setQuickAdd] = useState<{ x: number; y: number; query: string } | null>(null);
  const [manifests, setManifests] = useState<Record<string, NodeFormManifest>>({});
  const [httpProfiles, setHttpProfiles] = useState<HttpProfile[]>([]);
  const [runSnapshot, setRunSnapshot] = useState<{ run: RunRecord | null; events: RunEvent[] }>({ run: null, events: [] });
  const instance = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const viewportHost = useRef<HTMLDivElement | null>(null);
  const nodeTypeMap = useMemo(() => new Map(nodeTypes.map((type) => [type.id, type])), [nodeTypes]);
  const graph = useMemo(() => getActiveGraph(workflow, canvasScope), [workflow, canvasScope]);
  const scopeKey = canvasScope.map((segment) => `${segment.nodeId}:${segment.key}`).join("/") || "root";
  const focusedNodeId = graph.nodes.some((node) => node.id === hoveredNodeId) ? hoveredNodeId : selectedNodeId;
  const focusedEdges = useMemo(() => graph.edges.filter((edge) => edge.source === focusedNodeId || edge.target === focusedNodeId), [graph.edges, focusedNodeId]);
  useEffect(() => { setHoveredNodeId(null); }, [workflow.id, scopeKey]);

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
    let disposed = false;
    void Promise.all(nodeTypes.map(async (nodeType) => {
      try { return [nodeType.id, await apiClient.getNodeTypeManifest(nodeType.id)] as const; }
      catch { return [nodeType.id, { version: 1 }] as const; }
    })).then((entries) => { if (!disposed) setManifests(Object.fromEntries(entries)); });
    return () => { disposed = true; };
  }, [nodeTypes]);

  useEffect(() => {
    const loadHttpProfiles = () => { void apiClient.listHttpProfiles().then(setHttpProfiles).catch(() => setHttpProfiles([])); };
    loadHttpProfiles();
    window.addEventListener("nodeflow:http-profiles-changed", loadHttpProfiles);
    return () => window.removeEventListener("nodeflow:http-profiles-changed", loadHttpProfiles);
  }, []);

  useEffect(() => {
    const syncRunState = (event: Event) => {
      const detail = (event as CustomEvent<{ run: RunRecord | null; events: RunEvent[] }>).detail;
      if (!detail || (detail.run && detail.run.workflow_id !== workflow.id)) return;
      setRunSnapshot(detail);
    };
    const resetForNewRun = (event: Event) => {
      const run = (event as CustomEvent<RunRecord>).detail;
      if (run?.workflow_id === workflow.id) setRunSnapshot({ run, events: [] });
    };
    window.addEventListener("nodeflow:run-state", syncRunState);
    window.addEventListener("nodeflow:run-created", resetForNewRun);
    return () => {
      window.removeEventListener("nodeflow:run-state", syncRunState);
      window.removeEventListener("nodeflow:run-created", resetForNewRun);
    };
  }, [workflow.id]);

  useEffect(() => {
    const syncManifest = (event: Event) => {
      const { nodeTypeId, manifest } = (event as CustomEvent<{ nodeTypeId: string; manifest: NodeFormManifest }>).detail;
      if (!nodeTypeId || !manifest) return;
      setManifests((current) => ({ ...current, [nodeTypeId]: manifest }));
    };
    window.addEventListener("nodeflow:manifest-saved", syncManifest);
    return () => window.removeEventListener("nodeflow:manifest-saved", syncManifest);
  }, []);

  const documentNodes = useMemo<Node[]>(() => graph.nodes.map((workflowNode) => {
    const nodeType = nodeTypeMap.get(workflowNode.type);
    return {
      id: workflowNode.id,
      type: "workflowNode",
      position: workflowNode.position,
      selected: workflowNode.id === selectedNodeId,
      data: {
        workflowNode,
        nodeType,
        manifest: nodeType ? manifests[nodeType.id] : undefined,
        label: workflowNode.label || (nodeType ? nodeName(nodeType) : workflowNode.type),
        connectedOutputHandles: graph.edges.filter((edge) => edge.source === workflowNode.id).map((edge) => edge.sourceHandle),
        highlightedInputHandles: focusedEdges.filter((edge) => edge.target === workflowNode.id).map((edge) => edge.targetHandle),
        highlightedOutputHandles: focusedEdges.filter((edge) => edge.source === workflowNode.id).map((edge) => edge.sourceHandle),
        runStatus: nodeRunStatus(workflowNode.id, nodeType, runSnapshot.run, runSnapshot.events),
      },
    };
  }), [graph.nodes, graph.edges, focusedEdges, nodeTypeMap, selectedNodeId, manifests, runSnapshot]);

  useEffect(() => {
    setCanvasNodes((previous) => reconcileCanvasNodes(previous, documentNodes));
  }, [documentNodes]);

  const edges = useMemo<Edge[]>(() => graph.edges.map((edge) => {
    const itemCount = edgeItemCount(edge.source, edge.sourceHandle, runSnapshot.events);
    const highlighted = edge.source === focusedNodeId || edge.target === focusedNodeId;
    const errorPort = nodeTypeMap.get(graph.nodes.find((node) => node.id === edge.source)?.type ?? "")?.outputs[edge.sourceHandle]?.category === "error";
    const focusColor = errorPort ? "#fb7185" : categoryColor(nodeTypeMap.get(graph.nodes.find((node) => node.id === focusedNodeId)?.type ?? "")?.category ?? "");
    return {
      ...edge,
      type: "bezier",
      animated: false,
      className: highlighted ? "is-highlighted" : focusedNodeId ? "is-subdued" : "",
      style: { stroke: highlighted ? focusColor : "#526176", strokeWidth: highlighted ? 2.5 : 1.75, opacity: focusedNodeId && !highlighted ? 0.4 : 1 },
      ...(itemCount === null ? {} : {
        label: `${itemCount} 项`,
        labelStyle: { fill: highlighted ? "#e6edf6" : "#9eabc0", fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: "#171c27", fillOpacity: 0.96 },
        labelBgPadding: [5, 3] as [number, number],
        labelBgBorderRadius: 4,
      }),
    };
  }), [graph.nodes, graph.edges, focusedNodeId, nodeTypeMap, runSnapshot.events]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setCanvasNodes((current) => applyNodeChanges(changes, current));
    changes
      .filter((change) => change.type === "remove")
      .forEach((change) => deleteNode(change.id));
  }, [deleteNode]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    changes
      .filter((change) => change.type === "remove")
      .forEach((change) => deleteEdge(change.id));
  }, [deleteEdge]);

  const onNodeDragStop = useCallback((_: MouseEvent | TouchEvent, node: Node) => {
    updateNodePosition(node.id, node.position);
  }, [updateNodePosition]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) return;
    addEdge({
      id: `${connection.source}:${connection.sourceHandle}->${connection.target}:${connection.targetHandle}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
    });
    toast("已创建连接", "success");
  }, [addEdge]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => selectNode(node.id), [selectNode]);
  const onPaneClick = useCallback((event: React.MouseEvent) => {
    selectNode(null);
    if (event.detail !== 2 || !instance.current) return;
    const point = instance.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setQuickAdd({ ...point, query: "" });
  }, [selectNode]);
  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => deleteEdge(edge.id), [deleteEdge]);
  const nodeRenderer = useMemo(() => ({ workflowNode: (props: NodeProps<Node<NodeData>>) => <WorkflowNode {...props} httpProfiles={httpProfiles} onOpenSubflow={(node) => enterSubflow(node.id, "body", node.label || "循环体")} /> }), [enterSubflow, httpProfiles]);
  const quickAddResults = useMemo(() => {
    const query = quickAdd?.query.trim().toLowerCase() ?? "";
    return nodeTypes.filter((nodeType) => (canvasScope.length === 0 || nodeType.group !== "trigger") && (!query || [nodeType.id, nodeType.name, nodeName(nodeType), nodeDescription(nodeType), ...(nodeType.tags ?? [])].filter(Boolean).join(" ").toLowerCase().includes(query))).slice(0, 8);
  }, [canvasScope.length, nodeTypes, quickAdd?.query]);

  const addQuickNode = useCallback((nodeType: NodeType) => {
    if (!quickAdd) return;
    addNode(nodeType, { x: quickAdd.x, y: quickAdd.y });
    setQuickAdd(null);
  }, [addNode, quickAdd]);

  return (
    <div ref={viewportHost} className="relative h-full w-full">
      <ReactFlow
        key={`${workflow.id}:${scopeKey}`}
        nodes={canvasNodes}
        edges={edges}
        nodeTypes={nodeRenderer}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
        onNodeMouseLeave={(_, node) => setHoveredNodeId((current) => current === node.id ? null : current)}
        onPaneClick={onPaneClick}
        onEdgeClick={onEdgeClick}
        onInit={(flow) => { instance.current = flow; }}
        onMove={(_, viewport) => setZoom(viewport.zoom)}
        connectionLineType={ConnectionLineType.Bezier}
        defaultEdgeOptions={{ type: "bezier", style: { stroke: "#526176", strokeWidth: 2 } }}
        fitView
        fitViewOptions={{ padding: 0.12, minZoom: 0.3, maxZoom: 1.1 }}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={["Backspace", "Delete"]}
        edgesFocusable
        className="bg-canvas"
      >
        <Background gap={20} size={1} color="#273244" />
        {showMap && <MiniMap nodeColor={(node) => categoryColor(((node.data as { nodeType?: NodeType }).nodeType?.category) ?? "")} maskColor="rgba(5, 9, 16, 0.72)" className="!rounded-md !border !border-border !bg-surface" />}
      </ReactFlow>

      <div className="glass-island absolute left-3 top-3 flex max-w-[calc(100%-110px)] items-center gap-2 rounded-xl px-3 py-2.5">
        {canvasScope.length > 0 ? <>
          <button type="button" onClick={exitSubflow} className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-raised hover:text-text" aria-label="返回上一级流程" title="返回上一级流程"><ArrowLeft size={14} /></button>
          <GitBranch size={14} className="text-primary" />
          <span className="max-w-52 truncate text-xs font-medium" title={canvasScope.at(-1)?.label}>{canvasScope.at(-1)?.label}</span>
          <span className="text-[10px] text-muted">循环体</span>
        </> : <>
          <MousePointer2 size={14} className="text-primary" />
          <span className="text-xs font-medium">主流程</span>
          <span className="text-[10px] text-muted">拖拽 · 连线 · 双击添加</span>
        </>}
      </div>
      {quickAdd && <div className="absolute left-1/2 top-5 z-20 w-[330px] -translate-x-1/2 overflow-hidden rounded-md border border-border bg-surface shadow-[0_18px_48px_rgba(0,0,0,.42)]" role="dialog" aria-label="快速添加节点">
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2"><Search size={14} className="text-primary" /><input autoFocus value={quickAdd.query} onChange={(event) => setQuickAdd({ ...quickAdd, query: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape") setQuickAdd(null); if (event.key === "Enter" && quickAddResults[0]) addQuickNode(quickAddResults[0]); }} placeholder="搜索节点，Enter 添加第一个结果" className="min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-muted" /><button onClick={() => setQuickAdd(null)} className="text-muted hover:text-text" aria-label="关闭快速添加"><X size={14} /></button></div>
        <div className="max-h-72 overflow-y-auto p-1.5">{quickAddResults.length === 0 ? <p className="px-2 py-6 text-center text-xs text-muted">没有匹配的节点</p> : quickAddResults.map((nodeType) => <button key={nodeType.id} onClick={() => addQuickNode(nodeType)} className="flex w-full items-center gap-3 rounded px-2.5 py-2 text-left hover:bg-raised"><span className="h-2 w-2 rounded-full" style={{ background: categoryColor(nodeType.category) }} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{nodeName(nodeType)}</span><span className="block truncate text-[10px] text-muted">{nodeDescription(nodeType)}</span></span><span className="text-[10px] text-muted">{categoryName(nodeType.category)}</span></button>)}</div>
      </div>}
      <div className="glass-island absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl p-1">
        <button onClick={() => instance.current?.fitView({ padding: 0.12, duration: 220 })} className="island-button" aria-label="适配画布" title="查看完整流程"><Crosshair size={16} /></button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button onClick={() => instance.current?.zoomOut({ duration: 160 })} className="island-button" aria-label="缩小" title="缩小"><ZoomOut size={16} /></button>
        <button onClick={() => instance.current?.zoomTo(1, { duration: 160 })} className="min-w-11 rounded-lg py-2 text-[11px] text-text-secondary hover:bg-raised" title="恢复 100% 缩放">{Math.round(zoom * 100)}%</button>
        <button onClick={() => instance.current?.zoomIn({ duration: 160 })} className="island-button" aria-label="放大" title="放大"><ZoomIn size={16} /></button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button onClick={() => setShowMap((value) => !value)} className={`island-button ${showMap ? "active" : ""}`} aria-pressed={showMap} aria-label="切换缩略图" title="切换缩略图"><MapIcon size={16} /></button>
      </div>
    </div>
  );
}

type NodeData = {
  workflowNode: WorkflowNodeDocument;
  nodeType?: NodeType;
  manifest?: NodeFormManifest;
  label: string;
  connectedOutputHandles: string[];
  highlightedInputHandles: string[];
  highlightedOutputHandles: string[];
  runStatus: NodeRunStatus | null;
};

const WorkflowNode = memo(function WorkflowNode({ data, selected, httpProfiles, onOpenSubflow }: NodeProps<Node<NodeData>> & { httpProfiles: HttpProfile[]; onOpenSubflow: (node: WorkflowNodeDocument) => void }) {
  const updateNodeConfig = useWorkflowStore((state) => state.updateNodeConfig);
  return <NodeCard node={data.workflowNode} nodeType={data.nodeType} manifest={data.manifest} label={data.label} selected={selected} connectedOutputHandles={data.connectedOutputHandles} highlightedInputHandles={data.highlightedInputHandles} highlightedOutputHandles={data.highlightedOutputHandles} httpProfiles={httpProfiles} runStatus={data.runStatus} onConfigChange={(key, value) => updateNodeConfig(data.workflowNode.id, key, value)} onOpenSubflow={onOpenSubflow} renderHandle={(direction, id, port, color) => <Handle type={direction === "input" ? "target" : "source"} position={direction === "input" ? Position.Left : Position.Right} id={id} style={{ background: color }} className={NODE_HANDLE_CLASS} title={port.description ?? port.displayName ?? id} />} />;
});

function nodeRunStatus(nodeId: string, nodeType: NodeType | undefined, run: RunRecord | null, events: RunEvent[]): NodeRunStatus | null {
  if (!run) return null;
  const nodeEvents = events.filter((event) => event.node_id === nodeId);
  const latestEvent = nodeEvents.at(-1);
  const latest = latestEvent?.type ?? "";
  const outputs = latestEvent?.payload.outputs;
  if (outputs && typeof outputs === "object" && !Array.isArray(outputs)) {
    const emittedError = Object.keys(outputs).some((outputId) => nodeType?.outputs[outputId]?.category === "error");
    if (emittedError) return "failed";
  }
  if (latest.includes("failed") || latest.includes("error")) return "failed";
  if (latest.includes("succeeded") || latest.includes("pinned_data_used")) return "succeeded";
  if (latest.includes("skipped") || latest.includes("disabled")) return "skipped";
  if (latest.includes("started")) return "running";
  if (["queued", "running"].includes(run.status)) return "waiting";
  return null;
}

function edgeItemCount(nodeId: string, outputId: string, events: RunEvent[]): number | null {
  let total = 0;
  let matched = false;
  for (const event of events) {
    if (event.node_id !== nodeId || !["node_succeeded", "node_error_handled", "node_pinned_data_used"].includes(event.type)) continue;
    const outputItems = recordValue(event.payload.output_items)?.[outputId];
    if (Array.isArray(outputItems)) {
      total += outputItems.length;
      matched = true;
      continue;
    }
    const output = recordValue(event.payload.outputs)?.[outputId];
    if (output !== undefined) {
      total += Array.isArray(output) ? output.length : 1;
      matched = true;
    }
  }
  return matched ? total : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
