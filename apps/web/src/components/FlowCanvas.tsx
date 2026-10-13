import { useCallback, useEffect, useMemo, memo, useRef, useState } from "react";
import {
  Background,
  ConnectionLineType,
  Controls,
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
import { ArrowLeft, Check, Clock3, Crosshair, GitBranch, LoaderCircle, Map as MapIcon, MousePointer2, Search, X, ZoomIn } from "lucide-react";
import { apiClient } from "@/api/client";
import { getActiveGraph, useWorkflowStore } from "@/store/workflow";
import type { HttpProfile, NodeFormManifest, NodePort, NodeSummaryTemplate, NodeType, RunEvent, RunRecord, WorkflowNode as WorkflowNodeDocument } from "@/types";
import { toast } from "./Toaster";

const CATEGORY_COLORS: Record<string, string> = {
  trigger: "#75a7ff", webhook: "#75a7ff", schedule: "#f6c65b", http: "#58d3aa",
  assertion: "#fb7e8c", control: "#b498ff", data: "#6bc8f8", test: "#ef8fc3",
};

function categoryColor(category: string) {
  const normalized = category.toLowerCase();
  return Object.entries(CATEGORY_COLORS).find(([key]) => normalized.includes(key))?.[1] ?? "#70a4ff";
}

function portColor(port: NodePort, direction: "input" | "output") {
  if (port.category === "error") return "#fb7185";
  if (port.category === "control") return "#b498ff";
  return direction === "input" ? "#91a0b8" : "#58d3aa";
}

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
  const [showMap, setShowMap] = useState(true);
  const [canvasNodes, setCanvasNodes] = useState<Node[]>([]);
  const [quickAdd, setQuickAdd] = useState<{ x: number; y: number; query: string } | null>(null);
  const [manifests, setManifests] = useState<Record<string, NodeFormManifest>>({});
  const [httpProfiles, setHttpProfiles] = useState<HttpProfile[]>([]);
  const [runSnapshot, setRunSnapshot] = useState<{ run: RunRecord | null; events: RunEvent[] }>({ run: null, events: [] });
  const instance = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const nodeTypeMap = useMemo(() => new Map(nodeTypes.map((type) => [type.id, type])), [nodeTypes]);
  const graph = useMemo(() => getActiveGraph(workflow, canvasScope), [workflow, canvasScope]);
  const scopeKey = canvasScope.map((segment) => `${segment.nodeId}:${segment.key}`).join("/") || "root";

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
        label: workflowNode.label || nodeType?.displayName || nodeType?.name || workflowNode.type,
        connectedOutputHandles: graph.edges.filter((edge) => edge.source === workflowNode.id).map((edge) => edge.sourceHandle),
        runStatus: nodeRunStatus(workflowNode.id, nodeType, runSnapshot.run, runSnapshot.events),
      },
    };
  }), [graph.nodes, graph.edges, nodeTypeMap, selectedNodeId, manifests, runSnapshot]);

  useEffect(() => {
    setCanvasNodes((previous) => documentNodes.map((node) => {
      const current = previous.find((candidate) => candidate.id === node.id);
      return current?.dragging ? { ...node, position: current.position, dragging: true } : node;
    }));
  }, [documentNodes]);

  const edges = useMemo<Edge[]>(() => graph.edges.map((edge) => {
    const itemCount = edgeItemCount(edge.source, edge.sourceHandle, runSnapshot.events);
    return {
      ...edge,
      type: "bezier",
      animated: false,
      style: { stroke: "#526176", strokeWidth: 2 },
      ...(itemCount === null ? {} : {
        label: `${itemCount} ${itemCount === 1 ? "item" : "items"}`,
        labelStyle: { fill: "#9eabc0", fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: "#171c27", fillOpacity: 0.96 },
        labelBgPadding: [5, 3] as [number, number],
        labelBgBorderRadius: 4,
      }),
    };
  }), [graph.edges, runSnapshot.events]);

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
    return nodeTypes.filter((nodeType) => (canvasScope.length === 0 || nodeType.group !== "trigger") && (!query || [nodeType.id, nodeType.name, nodeType.displayName, nodeType.description, ...(nodeType.tags ?? [])].filter(Boolean).join(" ").toLowerCase().includes(query))).slice(0, 8);
  }, [canvasScope.length, nodeTypes, quickAdd?.query]);

  const addQuickNode = useCallback((nodeType: NodeType) => {
    if (!quickAdd) return;
    addNode(nodeType, { x: quickAdd.x, y: quickAdd.y });
    setQuickAdd(null);
  }, [addNode, quickAdd]);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        key={scopeKey}
        nodes={canvasNodes}
        edges={edges}
        nodeTypes={nodeRenderer}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onEdgeClick={onEdgeClick}
        onInit={(flow) => { instance.current = flow; }}
        connectionLineType={ConnectionLineType.Bezier}
        defaultEdgeOptions={{ type: "bezier", style: { stroke: "#526176", strokeWidth: 2 } }}
        fitView
        fitViewOptions={{ padding: 0.24, maxZoom: 1.1 }}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={["Backspace", "Delete"]}
        edgesFocusable
        className="bg-canvas"
      >
        <Background gap={20} size={1} color="#273244" />
        {showMap && <MiniMap nodeColor={(node) => categoryColor(((node.data as { nodeType?: NodeType }).nodeType?.category) ?? "")} maskColor="rgba(5, 9, 16, 0.72)" className="!rounded-md !border !border-border !bg-surface" />}
        <Controls showInteractive={false} className="!rounded-md !border !border-border !bg-surface [&_button]:!border-border [&_button]:!bg-surface [&_button]:!text-text" />
      </ReactFlow>

      <div className="absolute left-4 top-4 flex items-center gap-2 rounded-md border border-border/80 bg-surface/95 px-2.5 py-2 shadow-[0_10px_28px_rgba(0,0,0,.28)]">
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
        <div className="max-h-72 overflow-y-auto p-1.5">{quickAddResults.length === 0 ? <p className="px-2 py-6 text-center text-xs text-muted">没有匹配的节点</p> : quickAddResults.map((nodeType) => <button key={nodeType.id} onClick={() => addQuickNode(nodeType)} className="flex w-full items-center gap-3 rounded px-2.5 py-2 text-left hover:bg-raised"><span className="h-2 w-2 rounded-full" style={{ background: categoryColor(nodeType.category) }} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{nodeType.displayName ?? nodeType.name}</span><span className="block truncate text-[10px] text-muted">{nodeType.description}</span></span><span className="text-[10px] text-muted">{nodeType.category}</span></button>)}</div>
      </div>}
      <div className="absolute bottom-4 right-4 flex items-center gap-1 rounded-md border border-border bg-surface p-1 shadow-xl">
        <button onClick={() => instance.current?.fitView({ padding: 0.24, duration: 220 })} className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-raised hover:text-text" aria-label="适配画布" title="适配画布"><Crosshair size={14} /></button>
        <button onClick={() => instance.current?.zoomIn({ duration: 160 })} className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-raised hover:text-text" aria-label="放大" title="放大"><ZoomIn size={14} /></button>
        <button onClick={() => setShowMap((value) => !value)} className={`grid h-7 w-7 place-items-center rounded ${showMap ? "bg-primary/12 text-primary" : "text-muted hover:bg-raised hover:text-text"}`} aria-label="切换缩略图" title="切换缩略图"><MapIcon size={14} /></button>
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
  runStatus: NodeRunStatus | null;
};

const WorkflowNode = memo(function WorkflowNode({ data, selected, httpProfiles, onOpenSubflow }: NodeProps<Node<NodeData>> & { httpProfiles: HttpProfile[]; onOpenSubflow: (node: WorkflowNodeDocument) => void }) {
  const { workflowNode, nodeType, manifest, label, connectedOutputHandles, runStatus } = data;
  const color = manifest?.cardStyle?.accent ?? categoryColor(nodeType?.category ?? "");
  const compact = manifest?.cardStyle?.density === "compact";
  const inputs = orderedPorts("inputs", nodeType?.inputs ?? {}, manifest);
  const outputs = orderedPorts("outputs", nodeType?.outputs ?? {}, manifest);
  // Node Studio treats an unspecified placement as "panel". Keep this rule here
  // as well, otherwise the collapsed card looks right but its expanded state
  // leaks fields that were intentionally kept out of the canvas.
  const fields = nodeType?.form?.groups.flatMap((group) => group.fields).filter((field) => (manifest?.placements?.[field.key] ?? field.placement ?? "panel") === "inline") ?? [];
  const visibleFields = fields.slice(0, 3);
  const summary = manifest?.cardStyle?.summary === "hidden" ? null : nodeSummary(nodeType?.id, workflowNode, httpProfiles, manifest?.summaryTemplate);
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const visibleInputs = inputs.filter(([id, port]) => shouldShowPort("inputs", id, port, manifest, selected, connectedOutputHandles));
  const visibleOutputs = outputs.filter(([id, port]) => shouldShowPort("outputs", id, port, manifest, selected, connectedOutputHandles));
  const hasBodySubflow = Boolean(workflowNode.subflows?.body) || ["control.each_item", "control.foreach", "control.while"].includes(nodeType?.id ?? "");
  const bodyNodeCount = workflowNode.subflows?.body?.nodes.length ?? 0;

  return (
    <article className={`min-w-[250px] max-w-[310px] overflow-visible rounded-md border bg-surface shadow-[0_14px_34px_rgba(0,0,0,.34)] ${selected ? "border-primary ring-1 ring-primary/45" : "border-border hover:border-border-hover"} ${workflowNode.disabled ? "opacity-55" : ""}`}>
      <header className={`flex items-center gap-2 rounded-t-[5px] px-3 ${compact ? "h-8" : "h-9"}`} style={{ background: `${color}22`, borderBottom: `1px solid ${color}4d` }}>
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold" title={label}>{label}</h3>
        {runStatus && <NodeRunStatusBadge status={runStatus} />}
      </header>
      <div className={compact ? "py-0.5" : "py-1.5"}>
        {visibleInputs.map(([key, port]) => <PortRow key={`in-${key}`} id={key} port={port} direction="input" compact={compact} />)}
        {summary && <NodeSummaryView summary={summary} compact={compact} />}
        {hasBodySubflow && <button type="button" className="nodrag nopan nowheel mx-3 my-1.5 flex w-[calc(100%_-_1.5rem)] items-center justify-between rounded border border-border/70 bg-raised/55 px-2 py-1.5 text-[10px] text-text-secondary hover:border-primary/50 hover:text-text focus:outline-none focus:ring-1 focus:ring-primary/50" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpenSubflow(workflowNode); }}><span className="flex items-center gap-1.5"><GitBranch size={12} className="text-primary" />编辑循环体</span><span className="text-muted">{bodyNodeCount} 个节点</span></button>}
        {(visibleInputs.length > 0 || summary) && visibleFields.length > 0 && <div className="mx-3 my-1 border-t border-border/60" />}
        {visibleFields.map((field) => {
          const current = workflowNode.config[field.key];
          return <WidgetRow key={field.key} label={field.label ?? field.key} value={current} control={field.control} options={field.options} httpProfiles={httpProfiles} compact={compact} onChange={(value) => updateNodeConfig(workflowNode.id, field.key, value)} />;
        })}
        {fields.length > 3 && <p className="px-3 py-1.5 text-center text-[10px] text-muted">其余 {fields.length - 3} 项在右侧配置</p>}
        {visibleOutputs.length > 0 && visibleFields.length > 0 && <div className="mx-3 my-1 border-t border-border/60" />}
        {visibleOutputs.map(([key, port]) => <PortRow key={`out-${key}`} id={key} port={port} direction="output" compact={compact} />)}
        {!visibleInputs.length && !visibleOutputs.length && !summary && <p className="px-3 py-3 text-[11px] text-muted">此节点未声明端口</p>}
      </div>
    </article>
  );
});

function PortRow({ id, port, direction, compact }: { id: string; port: NodePort; direction: "input" | "output"; compact: boolean }) {
  const color = portColor(port, direction);
  const label = port.displayName ?? id;
  if (port.collapsed) return null;
  return <div className={`relative flex items-center px-3 text-[11px] ${compact ? "min-h-6" : "min-h-7"} ${direction === "output" ? "justify-end text-right" : "justify-start"}`}>
    <Handle type={direction === "input" ? "target" : "source"} position={direction === "input" ? Position.Left : Position.Right} id={id} style={{ background: color }} className="!h-3 !w-3 !border-2 !border-surface transition-transform hover:!scale-125" title={port.description ?? label} />
    <span className="truncate text-text-secondary">{label}{port.required && <span className="ml-1 text-danger">*</span>}</span>
  </div>;
}

function WidgetRow({ label, value, control, options, httpProfiles, compact, onChange }: { label: string; value: unknown; control: string; options?: { label: string; value: string }[]; httpProfiles: HttpProfile[]; compact: boolean; onChange: (value: unknown) => void }) {
  const base = "min-w-0 flex-1 rounded border border-border bg-raised px-2 py-1 text-[11px] text-text outline-none focus:border-primary";
  const rowHeight = compact ? "min-h-7" : "min-h-8";
  if (control === "switch") return <label className={`nodrag flex items-center gap-2 px-3 text-[11px] text-text-secondary ${rowHeight}`}><span className="w-[43%] truncate">{label}</span><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="h-3.5 w-3.5 accent-primary" /></label>;
  if (control === "select" && options) return <label className={`nodrag flex items-center gap-2 px-3 text-[11px] text-text-secondary ${rowHeight}`}><span className="w-[43%] truncate">{label}</span><select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} className={base}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
  if (control === "http_profile") return <label className={`nodrag flex items-center gap-2 px-3 text-[11px] text-text-secondary ${rowHeight}`}><span className="w-[43%] truncate">{label}</span><select aria-label={label} value={String(value ?? "")} onChange={(event) => onChange(event.target.value || null)} className={base} title={httpProfiles.find((profile) => profile.id === value)?.base_url ?? ""}><option value="">未设置</option>{httpProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>;
  return <label className={`nodrag flex items-center gap-2 px-3 text-[11px] text-text-secondary ${rowHeight}`}><span className="w-[43%] truncate">{label}</span><input type={control === "number" ? "number" : "text"} value={typeof value === "string" || typeof value === "number" ? String(value) : ""} onChange={(event) => onChange(control === "number" ? Number(event.target.value) : event.target.value)} className={base} /></label>;
}

function orderedPorts(direction: "inputs" | "outputs", ports: Record<string, NodePort>, manifest?: NodeFormManifest) {
  return Object.entries(ports).map(([id, port]) => [id, { ...port, ...manifest?.portPresentation?.[direction]?.[id] }] as const).sort(([leftId, left], [rightId, right]) => (left.order ?? 0) - (right.order ?? 0) || leftId.localeCompare(rightId));
}

type NodeSummary = { badge: string; primary: string; secondary?: string; warning?: boolean };
type NodeRunStatus = "waiting" | "running" | "succeeded" | "failed" | "skipped";

const NODE_RUN_STATUS: Record<NodeRunStatus, { label: string; className: string; icon: typeof Check }> = {
  waiting: { label: "等待", className: "bg-raised text-muted", icon: Clock3 },
  running: { label: "运行中", className: "bg-primary/15 text-primary", icon: LoaderCircle },
  succeeded: { label: "成功", className: "bg-success/12 text-success", icon: Check },
  failed: { label: "失败", className: "bg-danger/12 text-danger", icon: X },
  skipped: { label: "跳过", className: "bg-raised text-muted", icon: X },
};

function NodeRunStatusBadge({ status }: { status: NodeRunStatus }) {
  const definition = NODE_RUN_STATUS[status];
  const Icon = definition.icon;
  return <span className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium ${definition.className}`} title={`最近一次运行：${definition.label}`}>
    <Icon size={10} className={status === "running" ? "animate-spin" : ""} />
    {definition.label}
  </span>;
}

function NodeSummaryView({ summary, compact }: { summary: NodeSummary; compact: boolean }) {
  return <div className={`nodrag mx-3 border-y border-border/60 ${compact ? "py-1" : "py-1.5"}`}>
    <div className="flex min-w-0 items-center gap-1.5 text-[10px]">
      <span className={`shrink-0 rounded px-1.5 py-0.5 font-semibold ${summary.warning ? "bg-warning/12 text-warning" : "bg-primary/12 text-primary"}`}>{summary.badge}</span>
      <span className={`min-w-0 truncate ${summary.warning ? "text-warning" : "text-text-secondary"}`} title={summary.primary}>{summary.primary}</span>
    </div>
    {summary.secondary && <p className="mt-1 truncate text-[10px] text-muted" title={summary.secondary}>{summary.secondary}</p>}
  </div>;
}

function shouldShowPort(direction: "inputs" | "outputs", id: string, port: NodePort, manifest: NodeFormManifest | undefined, selected: boolean, connectedOutputs: string[]) {
  const configured = manifest?.portPresentation?.[direction]?.[id]?.collapsed;
  if (configured === true || (configured === undefined && port.collapsed)) return false;
  if (configured === false) return true;
  if (direction === "outputs" && port.category === "error") return selected || connectedOutputs.includes(id);
  return true;
}

function nodeSummary(nodeTypeId: string | undefined, node: WorkflowNodeDocument, httpProfiles: HttpProfile[], template?: NodeSummaryTemplate | null): NodeSummary | null {
  const config = node.config;
  if (template?.primary?.trim()) {
    return {
      badge: renderSummaryTemplate(template.badge || "摘要", config),
      primary: renderSummaryTemplate(template.primary, config),
      secondary: template.secondary?.trim() ? renderSummaryTemplate(template.secondary, config) : undefined,
    };
  }
  if (nodeTypeId === "http.request") {
    const method = typeof config.method === "string" ? config.method.toUpperCase() : "GET";
    const profile = httpProfiles.find((candidate) => candidate.id === config.http_profile_id);
    const url = typeof config.url === "string" && config.url.trim() ? config.url.trim() : "未设置 URL";
    return { badge: method, primary: profile?.name ?? "未选择 HTTP 配置档", secondary: url, warning: !profile || url === "未设置 URL" };
  }
  if (nodeTypeId === "control.each_item") {
    const maximum = typeof config.max_items === "number" ? config.max_items : 100;
    const subflowCount = Object.values(node.subflows ?? {}).reduce((count, subflow) => count + subflow.nodes.length, 0);
    return {
      badge: "循环",
      primary: `最多 ${maximum} 项 · ${config.continue_on_error ? "失败后继续" : "遇错停止"}`,
      secondary: subflowCount > 0 ? `循环体包含 ${subflowCount} 个节点` : "循环体尚未配置",
      warning: subflowCount === 0,
    };
  }
  if (nodeTypeId === "data.group_items") {
    const paths = stringList(config.paths);
    return { badge: "分组", primary: paths.length ? `按 ${paths.join("、")} 分组` : "未设置分组字段", warning: paths.length === 0 };
  }
  if (nodeTypeId === "data.json_template") {
    const template = parsedValue(config.template);
    if (Array.isArray(template)) return { badge: "JSON", primary: `数组模板 · ${template.length} 项` };
    if (template && typeof template === "object") return { badge: "JSON", primary: `对象模板 · ${Object.keys(template).length} 个字段`, secondary: Object.keys(template).slice(0, 4).join("、") };
    return { badge: "JSON", primary: "未配置模板", warning: true };
  }
  return null;
}

function renderSummaryTemplate(template: string, config: Record<string, unknown>) {
  return template.replace(/\{\{\s*(?:config\.)?([\w.-]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split(".").reduce<unknown>((current, key) => recordValue(current)?.[key], config);
    if (value === undefined || value === null || value === "") return "未设置";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}

function parsedValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function stringList(value: unknown): string[] {
  const parsed = parsedValue(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

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
