import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Activity, Braces, GitBranch, MousePointer2, Settings2, Trash2 } from "lucide-react";
import { apiClient } from "@/api/client";
import { getActiveGraph, useWorkflowStore } from "@/store/workflow";
import type { HttpProfile, NodeFormField, NodeType, RunEvent, RunRecord, WorkflowNode } from "@/types";
import { nodeDescription, nodeIcon, nodeName } from "@/lib/nodePresentation";
import { NumberInput } from "./NumberInput";

type PanelTab = "config" | "runtime";
type RuntimeTab = "input" | "output" | "error";

export function ConfigPanel({ runSnapshot }: { runSnapshot: { run: RunRecord | null; events: RunEvent[] } }) {
  const workflow = useWorkflowStore((state) => state.workflow);
  const canvasScope = useWorkflowStore((state) => state.canvasScope);
  const nodeTypes = useWorkflowStore((state) => state.nodeTypes);
  const selectedNodeId = useWorkflowStore((state) => state.selectedNodeId);
  const updateNodeConfig = useWorkflowStore((state) => state.updateNodeConfig);
  const updateNodeLabel = useWorkflowStore((state) => state.updateNodeLabel);
  const deleteNode = useWorkflowStore((state) => state.deleteNode);
  const enterSubflow = useWorkflowStore((state) => state.enterSubflow);
  const [httpProfiles, setHttpProfiles] = useState<HttpProfile[]>([]);
  const [panelTab, setPanelTab] = useState<PanelTab>("config");
  const graph = useMemo(() => getActiveGraph(workflow, canvasScope), [workflow, canvasScope]);
  const nodeTypeMap = useMemo(() => new Map(nodeTypes.map((nodeType) => [nodeType.id, nodeType])), [nodeTypes]);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  const nodeType = selectedNode ? nodeTypeMap.get(selectedNode.type) : undefined;

  const loadHttpProfiles = useCallback(() => {
    void apiClient.listHttpProfiles().then(setHttpProfiles).catch(() => setHttpProfiles([]));
  }, []);

  useEffect(() => {
    if (nodeType?.form?.groups.some((group) => group.fields.some((field) => field.control === "http_profile"))) loadHttpProfiles();
  }, [loadHttpProfiles, nodeType?.id]);

  useEffect(() => {
    window.addEventListener("nodeflow:http-profiles-changed", loadHttpProfiles);
    return () => window.removeEventListener("nodeflow:http-profiles-changed", loadHttpProfiles);
  }, [loadHttpProfiles]);

  useEffect(() => { setPanelTab("config"); }, [selectedNodeId, canvasScope]);

  if (!selectedNode || !nodeType) {
    return <div className="flex h-full flex-col items-center justify-center p-5 text-center text-muted">
      <MousePointer2 size={28} className="mb-3 opacity-30" />
      <p className="text-sm text-text-secondary">未选中节点</p>
      <p className="mt-1 text-xs">点击画布节点开始编辑</p>
    </div>;
  }

  const Icon = nodeIcon(nodeType);
  return <div className="node-config flex h-full min-h-0 flex-col">
    <header className="border-b border-border/70 px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate text-sm font-semibold"><Icon size={16} className="shrink-0 text-primary" />{nodeName(nodeType)}</h2>
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">{nodeDescription(nodeType)}</p>
        </div>
        <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[9px] text-muted">v{nodeType.version ?? 1}</span>
      </div>
    </header>
    <nav className="grid grid-cols-2 border-b border-border/70 p-1.5" aria-label="节点面板">
      <PanelTabButton active={panelTab === "config"} icon={Settings2} label="配置" onClick={() => setPanelTab("config")} />
      <PanelTabButton active={panelTab === "runtime"} icon={Activity} label="运行数据" onClick={() => setPanelTab("runtime")} />
    </nav>
    {panelTab === "config" ? <NodeConfigEditor node={selectedNode} nodeType={nodeType} httpProfiles={httpProfiles} onConfigChange={updateNodeConfig} onLabelChange={updateNodeLabel} onDelete={deleteNode} onOpenSubflow={() => enterSubflow(selectedNode.id, "body", selectedNode.label || nodeType.displayName || nodeType.name)} /> : <NodeRuntimeInspector node={selectedNode} nodeType={nodeType} run={runSnapshot.run} events={runSnapshot.events} />}
  </div>;
}

function PanelTabButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof Activity; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex h-8 items-center justify-center gap-1.5 rounded text-xs transition-colors focus:outline-none focus:ring-1 focus:ring-primary ${active ? "bg-primary/12 text-primary" : "text-muted hover:bg-raised hover:text-text"}`}><Icon size={13} />{label}</button>;
}

function NodeConfigEditor({ node, nodeType, httpProfiles, onConfigChange, onLabelChange, onDelete, onOpenSubflow }: { node: WorkflowNode; nodeType: NodeType; httpProfiles: HttpProfile[]; onConfigChange: (nodeId: string, key: string, value: unknown) => void; onLabelChange: (nodeId: string, label: string) => void; onDelete: (nodeId: string) => void; onOpenSubflow: () => void }) {
  const properties = nodeType.configSchema?.properties ?? {};
  const required = new Set(Array.isArray(nodeType.configSchema?.required) ? nodeType.configSchema.required : []);
  const groups = nodeType.form?.groups ?? [];
  const hasBodySubflow = Boolean(node.subflows?.body) || ["control.each_item", "control.foreach", "control.while"].includes(nodeType.id);
  return <>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-border/70 px-4 py-3">
        <label className="mb-1 block text-xs font-medium text-text-secondary">节点名称</label>
        <input value={node.label ?? ""} onChange={(event) => onLabelChange(node.id, event.target.value)} placeholder={nodeName(nodeType)} className="w-full rounded border border-border bg-raised px-2 py-1.5 text-xs text-text outline-none focus:border-primary" />
        <p className="mt-1 text-[10px] text-muted">用于画布和运行日志</p>
        {hasBodySubflow && <button type="button" onClick={onOpenSubflow} className="mt-3 flex h-8 w-full items-center justify-between rounded border border-primary/35 bg-primary/8 px-2.5 text-xs text-primary hover:bg-primary/14 focus:outline-none focus:ring-1 focus:ring-primary"><span className="flex items-center gap-1.5"><GitBranch size={13} />编辑循环体</span><span className="text-[10px] text-muted">{node.subflows?.body?.nodes.length ?? 0} 个节点</span></button>}
      </div>
      {groups.length > 0 ? groups.map((group) => <fieldset key={group.id} className="border-b border-border/70 px-4 py-3 last:border-b-0">
        <legend className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">{group.label}</legend>
        {group.description && <p className="mb-2 text-[10px] leading-relaxed text-muted">{group.description}</p>}
        {group.fields.map((field) => <ConfigField key={field.key} field={field} value={node.config[field.key]} required={required.has(field.key)} httpProfiles={httpProfiles} onChange={(value) => onConfigChange(node.id, field.key, value)} />)}
      </fieldset>) : Object.keys(properties).map((key) => <div key={key} className="border-b border-border/70 px-4 py-3"><ConfigField field={{ key, control: "text", label: key }} value={node.config[key]} required={required.has(key)} httpProfiles={httpProfiles} onChange={(value) => onConfigChange(node.id, key, value)} /></div>)}
    </div>
    <div className="border-t border-border/70 p-3">
      <button type="button" onClick={() => onDelete(node.id)} className="flex h-8 items-center gap-1.5 rounded px-2 text-xs text-danger hover:bg-danger/10 focus:outline-none focus:ring-1 focus:ring-danger"><Trash2 size={13} />删除节点</button>
    </div>
  </>;
}

function ConfigField({ field, value, required, httpProfiles, onChange }: { field: NodeFormField; value: unknown; required: boolean; httpProfiles: HttpProfile[]; onChange: (value: unknown) => void }) {
  const id = useId();
  const label = <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-text-secondary">{field.label ?? field.key}{required && <span className="ml-1 text-[10px] font-normal text-danger">必填</span>}</label>;
  const shell = "mb-3 last:mb-0";
  const input = "w-full rounded border border-border bg-raised px-2 py-1.5 text-xs text-text outline-none focus:border-primary";
  if (field.control === "switch") return <label className={`${shell} flex items-center gap-2 text-xs font-medium`}><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-primary" />{field.label ?? field.key}</label>;
  if (field.control === "select" && field.options) return <div className={shell}>{label}<select id={id} value={String(value ?? field.options[0]?.value ?? "")} onChange={(event) => onChange(event.target.value)} className={input}>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
  if (field.control === "http_profile") return <div className={shell}>{label}<select id={id} value={String(value ?? "")} onChange={(event) => onChange(event.target.value || null)} className={input}><option value="">不使用配置档</option>{httpProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.base_url ? ` · ${profile.base_url}` : ""}</option>)}</select>{field.description && <p className="mt-1 text-[10px] leading-relaxed text-muted">{field.description}</p>}</div>;
  if (field.control === "number") return <div className={shell}>{label}<NumberInput id={id} aria-label={field.label ?? field.key} value={typeof value === "number" ? value : ""} onValueChange={(value) => onChange(value === "" ? null : Number(value))} className="w-40 max-w-full" /></div>;
  if (field.control === "json" || field.control === "textarea") return <div className={shell}>{label}<textarea id={id} rows={5} value={typeof value === "object" ? JSON.stringify(value, null, 2) : String(value ?? "")} onChange={(event) => { if (field.control !== "json") return onChange(event.target.value); try { onChange(JSON.parse(event.target.value)); } catch { onChange(event.target.value); } }} placeholder={field.placeholder} className={`${input} resize-y font-mono leading-relaxed`} /></div>;
  return <div className={shell}>{label}<input id={id} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder ?? ""} className={input} /></div>;
}

function NodeRuntimeInspector({ node, nodeType, run, events }: { node: WorkflowNode; nodeType: NodeType; run: RunRecord | null; events: RunEvent[] }) {
  const nodeEvents = events.filter((event) => event.node_id === node.id);
  const started = nodeEvents.filter((event) => event.type === "node_started").at(-1);
  const completed = nodeEvents.filter((event) => ["node_succeeded", "node_error_handled", "node_pinned_data_used", "node_failed"].includes(event.type)).at(-1);
  const inputs = started?.payload.inputs;
  const outputs = completed?.payload.outputs;
  const outputRecord = recordValue(outputs);
  const errorPortIds = Object.entries(nodeType.outputs).filter(([, port]) => port.category === "error").map(([id]) => id);
  const emittedError = errorPortIds.map((id) => outputRecord?.[id]).find((current) => current !== undefined);
  const error = emittedError ?? completed?.payload.error ?? (completed?.type === "node_failed" ? completed.payload : undefined);
  const defaultTab: RuntimeTab = error !== undefined ? "error" : outputs !== undefined ? "output" : "input";
  const [tab, setTab] = useState<RuntimeTab>(defaultTab);
  useEffect(() => { setTab(defaultTab); }, [node.id, completed?.id, started?.id, defaultTab]);
  const value = tab === "input" ? inputs : tab === "output" ? outputs : error;

  if (!run) return <RuntimeEmpty icon={Activity} title="尚无运行数据" detail="运行工作流后，可在这里查看该节点的输入、输出和错误。" />;
  if (nodeEvents.length === 0) return <RuntimeEmpty icon={Braces} title="本次运行未执行该节点" detail="节点可能不在当前分支，或工作流在到达这里之前已经结束。" />;

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="border-b border-border/70 px-4 py-3">
      <div className="flex items-center gap-2"><Activity size={13} className="text-primary" /><span className="text-xs font-semibold">最近一次执行</span><span className="ml-auto text-[10px] text-muted">{nodeEvents.length} 个事件</span></div>
      <p className="mt-1 truncate font-mono text-[10px] text-muted" title={run.id}>运行 #{run.id.slice(0, 8)} · {completed?.timestamp?.slice(11, 19) ?? started?.timestamp?.slice(11, 19) ?? "等待中"}</p>
    </div>
    <div className="grid grid-cols-3 gap-1 border-b border-border/70 p-1.5">
      <RuntimeTabButton active={tab === "input"} disabled={inputs === undefined} label="输入" onClick={() => setTab("input")} />
      <RuntimeTabButton active={tab === "output"} disabled={outputs === undefined} label="输出" onClick={() => setTab("output")} />
      <RuntimeTabButton active={tab === "error"} disabled={error === undefined} label="错误" danger onClick={() => setTab("error")} />
    </div>
    <div className="event-json-scroll min-h-0 flex-1 overflow-auto p-3">
      {value === undefined ? <p className="py-8 text-center text-xs text-muted">没有可展示的数据</p> : <pre className="min-w-max whitespace-pre-wrap break-words rounded border border-border/70 bg-canvas p-3 font-mono text-[10px] leading-relaxed text-text-secondary">{safeJson(value)}</pre>}
    </div>
  </div>;
}

function RuntimeTabButton({ active, disabled, label, danger, onClick }: { active: boolean; disabled: boolean; label: string; danger?: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`h-7 rounded text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${active ? danger ? "bg-danger/12 text-danger" : "bg-primary/12 text-primary" : "text-muted hover:bg-raised hover:text-text"}`}>{label}</button>;
}

function RuntimeEmpty({ icon: Icon, title, detail }: { icon: typeof Activity; title: string; detail: string }) {
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-5 text-center"><Icon size={25} className="mb-3 text-muted opacity-40" /><p className="text-xs font-medium text-text-secondary">{title}</p><p className="mt-1 max-w-56 text-[11px] leading-relaxed text-muted">{detail}</p></div>;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeJson(value: unknown) {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
