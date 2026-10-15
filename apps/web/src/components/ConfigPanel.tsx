import { GroupFieldsEditor } from "./GroupFieldsEditor";
import { withCommonGroupFields } from "@/lib/groupFields";
import { Switch } from "./Switch";
import { TextInput } from "./TextInput";
import { Select } from "./Select";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Activity, Braces, GitBranch, MousePointer2, Settings2, Trash2 } from "lucide-react";
import { apiClient } from "@/api/client";
import { getActiveGraph, useWorkflowStore } from "@/store/workflow";
import type { HttpProfile, NodeFormField, NodeType, ResourceProfile, RunEvent, RunRecord, WorkflowNode } from "@/types";
import { nodeDescription, nodeIcon, nodeName } from "@/lib/nodePresentation";
import { NumberInput } from "./NumberInput";
import { ParameterDefinitionsEditor } from "./ParameterDefinitionsEditor";
import { StringListEditor } from "./StringListEditor";
import { DataRulesEditor } from "./DataRulesEditor";
import { ComposeConfigEditor } from "./ComposeConfigEditor";
import { ExtraConfigurationFields, FieldValueSource, bindingAllowed } from "./FieldValueSource";

import { SaveLibraryAsset } from "./SaveLibraryAsset";

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
  const canvasScope = useWorkflowStore((state) => state.canvasScope);
  const replaceConfig = useWorkflowStore((state) => state.replaceNodeConfig);
  const [profiles, setProfiles] = useState<ResourceProfile[]>([]);
  useEffect(() => {
    const load = () => { if (nodeType.profileType) void apiClient.listProfiles().then(setProfiles).catch(() => setProfiles([])); };
    load(); window.addEventListener("nodeflow:profiles-changed", load);
    return () => window.removeEventListener("nodeflow:profiles-changed", load);
  }, [nodeType.profileType?.id]);
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
        <p className="mt-2 text-[10px] text-muted">预演：{nodeType.previewSupport === "execute" ? (nodeType.effect === "read" ? "支持，会读取数据" : "支持，执行计算") : nodeType.previewSupport === "plan" ? "支持，生成操作计划" : "尚不支持"}</p>
        {hasBodySubflow && <button type="button" onClick={onOpenSubflow} className="mt-3 flex h-8 w-full items-center justify-between rounded border border-primary/35 bg-primary/8 px-2.5 text-xs text-primary hover:bg-primary/14 focus:outline-none focus:ring-1 focus:ring-primary"><span className="flex items-center gap-1.5"><GitBranch size={13} />编辑循环体</span><span className="text-[10px] text-muted">{node.subflows?.body?.nodes.length ?? 0} 个节点</span></button>}
      </div>
      {nodeType.profileType && <div className="border-b border-border/70 px-4 py-3">
        <FieldValueSource node={node} nodeType={nodeType} path="profile_id" label="业务配置档">
        {String(node.config.profile_id ?? "").includes("{{") ? <><input aria-label="业务配置档" id="node-profile" className="w-full rounded border border-border bg-raised p-2 font-mono text-xs" value={String(node.config.profile_id)} onChange={(event) => onConfigChange(node.id, "profile_id", event.target.value)} /><button type="button" className="mt-1 text-[10px] text-primary" onClick={() => onConfigChange(node.id, "profile_id", "")}>选择固定配置档</button></> : <><Select aria-label="业务配置档" id="node-profile" className="w-full rounded border border-border bg-raised p-2 text-xs" value={String(node.config.profile_id ?? "")} onValueChange={(selectedValue) => onConfigChange(node.id, "profile_id", selectedValue)}><option value="">请选择配置档</option>{profiles.filter((profile) => profile.type_id === nodeType.profileType?.id).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</Select><button type="button" className="mt-1 text-[10px] text-primary" onClick={() => onConfigChange(node.id, "profile_id", "{{ project.connection }}")}>通过环境变量选择</button></>}
        </FieldValueSource><p className="mt-2 text-[10px] text-muted">在资源中心管理 {nodeType.profileType.name}</p>
      </div>}
      {nodeType.id === "data.compose" ? <ComposeConfigEditor key={node.id} config={node.config} onChange={(key, value) => onConfigChange(node.id, key, value)} /> : groups.length > 0 ? groups.map((group) => <fieldset key={group.id} className="border-b border-border/70 px-4 py-3 last:border-b-0">
        <legend className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">{group.label}</legend>
        {group.description && <p className="mb-2 text-[10px] leading-relaxed text-muted">{group.description}</p>}
        {group.fields.filter((field) => !(nodeType.profileType && field.key === "profile_id")).map((field) => {
          const editableSource = bindingAllowed(nodeType, field.key) && (!["parameter_list", "column_rules", "mapping_rules", "group_fields"].includes(field.control) || !!node.configBindings?.[field.key]);
          const input = field.control === "group_fields" ? <GroupFieldsEditor key={node.id} config={node.config} bindings={node.configBindings} onChange={(fields) => replaceConfig(node.id, withCommonGroupFields(node.config, fields))} /> : <ConfigField hideLabel={editableSource} field={field} value={node.config[field.key]} required={required.has(field.key)} httpProfiles={httpProfiles} onChange={(value) => onConfigChange(node.id, field.key, value)} />;
          return editableSource ? <FieldValueSource key={`${node.id}:${field.key}`} node={node} nodeType={nodeType} path={field.key} label={`${field.label ?? field.key}${required.has(field.key) ? " *" : ""}`}>{input}</FieldValueSource> : <div key={field.key}>{input}</div>;
        })}
      </fieldset>) : Object.keys(properties).filter((key) => !(nodeType.profileType && key === "profile_id")).map((key) => <div key={key} className="border-b border-border/70 px-4 py-3"><FieldValueSource node={node} nodeType={nodeType} path={key} label={key}><ConfigField hideLabel={bindingAllowed(nodeType, key)} field={{ key, control: "text", label: key }} value={node.config[key]} required={required.has(key)} httpProfiles={httpProfiles} onChange={(value) => onConfigChange(node.id, key, value)} /></FieldValueSource></div>)}
      <ExtraConfigurationFields key={node.id} node={node} nodeType={nodeType} />
    </div>
    <div className="border-t border-border/70 p-3">
      <SaveLibraryAsset preset />
      {hasBodySubflow && <SaveLibraryAsset preset={false} templateKind="subflow" scopeOverride={[...canvasScope, { nodeId: node.id, key: "body", label: node.label || "循环体" }]} />}
      <button type="button" onClick={() => onDelete(node.id)} className="flex h-8 items-center gap-1.5 rounded px-2 text-xs text-danger hover:bg-danger/10 focus:outline-none focus:ring-1 focus:ring-danger"><Trash2 size={13} />删除节点</button>
    </div>
  </>;
}

function ConfigField({ field, value, required, httpProfiles, onChange, hideLabel = false }: { hideLabel?: boolean; field: NodeFormField; value: unknown; required: boolean; httpProfiles: HttpProfile[]; onChange: (value: unknown) => void }) {
  const id = useId();
  const [expressionEditing, setExpressionEditing] = useState(false);
  const label = hideLabel ? null : <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-text-secondary">{field.label ?? field.key}{required && <span className="ml-1 text-[10px] font-normal text-danger">必填</span>}</label>;
  const shell = "mb-3 last:mb-0";
  const input = "w-full rounded border border-border bg-raised px-2 py-1.5 text-xs text-text outline-none focus:border-primary";
  if (field.control === "column_rules" || field.control === "mapping_rules") return <div className={shell}>{field.control === "column_rules" ? <div className="mb-3"><h3 className="text-xs font-semibold">字段映射</h3><p className="mt-1 text-[11px] text-muted">{Array.isArray(value) ? value.length : 0} 个字段 · 点击一行修改来源或类型</p></div> : label}<DataRulesEditor label={field.label ?? field.key} value={value} onChange={onChange} columns={field.control === "column_rules"} /></div>;
  if (field.control === "parameter_list") return <div className={shell}><ParameterDefinitionsEditor value={value} onChange={onChange} /></div>;
  if (field.control === "string_list") return <div className={shell}>{label}<StringListEditor id={id} label={field.label ?? field.key} value={value} onChange={onChange} />{field.description && <p className="mt-1 text-[10px] text-muted">{field.description}</p>}</div>;
  if (field.control === "switch") return <div className={shell}><label className="flex min-h-[34px] cursor-pointer items-center justify-between gap-3 text-xs text-text-secondary"><span>{hideLabel ? (Boolean(value) ? "开启" : "关闭") : field.label ?? field.key}</span><Switch id={id} aria-label={field.label ?? field.key} checked={Boolean(value)} onCheckedChange={onChange} /></label>{field.description && <p className="mt-1 text-[10px] leading-relaxed text-muted">{field.description}</p>}</div>;
  if (field.control === "select" && field.options) {
    const expression = expressionEditing || (typeof value === "string" && value.includes("{{"));
    return <div className={shell}>{label}{expression ? <TextInput id={id} aria-label={field.label ?? field.key} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} placeholder="{{ run_parameters.mode }}" className="w-full font-mono" /> : <Select id={id} aria-label={field.label ?? field.key} value={String(value ?? field.options[0]?.value ?? "")} onValueChange={(selectedValue) => onChange(selectedValue)} className={input}>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>}{field.expression !== "disabled" && <button type="button" className="mt-1 text-[10px] text-primary" onClick={() => { if (expression) { setExpressionEditing(false); onChange(field.options?.[0]?.value ?? ""); } else setExpressionEditing(true); }}>{expression ? "选择固定值" : "使用表达式"}</button>}</div>;
  }
  if (field.control === "http_profile") return <div className={shell}>{label}<Select id={id} aria-label={field.label ?? field.key} value={String(value ?? "")} onValueChange={(selectedValue) => onChange(selectedValue || null)} className={input}><option value="">不使用配置档</option>{httpProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.base_url ? ` · ${profile.base_url}` : ""}</option>)}</Select>{field.description && <p className="mt-1 text-[10px] leading-relaxed text-muted">{field.description}</p>}</div>;
  if (field.control === "number") return <div className={shell}>{label}<NumberInput id={id} aria-label={field.label ?? field.key} value={typeof value === "number" ? value : ""} onValueChange={(value) => onChange(value === "" ? null : Number(value))} className="w-40 max-w-full" /></div>;
  if (field.control === "json" || field.control === "textarea") return <div className={shell}>{label}<textarea id={id} aria-label={field.label ?? field.key} rows={5} value={typeof value === "object" ? JSON.stringify(value, null, 2) : String(value ?? "")} onChange={(event) => { if (field.control !== "json") return onChange(event.target.value); try { onChange(JSON.parse(event.target.value)); } catch { onChange(event.target.value); } }} placeholder={field.placeholder} className={`${input} resize-y font-mono leading-relaxed`} /></div>;
  return <div className={shell}>{label}<TextInput id={id} aria-label={field.label ?? field.key} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder ?? ""} className="w-full" /></div>;
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
