import { Select } from "./Select";
import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Palette, PanelsTopLeft, Save, Search, SlidersHorizontal } from "lucide-react";
import { apiClient } from "@/api/client";
import { useWorkflowStore } from "@/store/workflow";
import type { HttpProfile, NodeCardStyle, NodeFormManifest, NodePort, NodePortPresentation, NodeSummaryTemplate, NodeType } from "@/types";
import { toast } from "./Toaster";
import { NodeCard } from "./NodeCard";
import { NumberInput } from "./NumberInput";
import { createNodeInstance, nodeConfigDefaults, resolveNodePorts } from "@/lib/nodeInstance";
import { categoryColor, categoryName, nodeIcon, nodeName } from "@/lib/nodePresentation";

const emptyManifest = (): NodeFormManifest => ({ version: 1, placements: {}, portPresentation: { inputs: {}, outputs: {} } });
const ACCENT_OPTIONS = ["#70a4ff", "#58d3aa", "#f6c65b", "#fb7e8c", "#b498ff", "#6bc8f8"];

function saveErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "无法保存展示清单";
  const message = error.message.replace(/^API \d+:\s*/, "").trim();
  try {
    const detail = JSON.parse(message).detail;
    if (typeof detail === "string") return detail;
  } catch {
    // Keep a network or non-JSON error useful to the user.
  }
  return message || "无法保存展示清单";
}

export function NodeStudio() {
  const [nodeTypes, setNodeTypes] = useState<NodeType[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [manifest, setManifest] = useState<NodeFormManifest>(emptyManifest);
  const manifestRequest = useRef(0);
  const activeNodeId = useRef(selectedId);
  activeNodeId.current = selectedId;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<{ nodeId: string; config: Record<string, unknown> }>({ nodeId: "", config: {} });
  const loadCanvasNodeTypes = useWorkflowStore((state) => state.loadNodeTypes);
  const selected = useMemo(() => nodeTypes.find((node) => node.id === selectedId) ?? null, [nodeTypes, selectedId]);
  const previewConfig = useMemo(() => selected ? previewState.nodeId === selected.id ? previewState.config : nodeConfigDefaults(selected) : {}, [selected, previewState]);
  const editorNode = useMemo(() => selected ? { ...selected, inputs: resolveNodePorts(selected, previewConfig, "inputs"), outputs: resolveNodePorts(selected, previewConfig, "outputs") } : null, [selected, previewConfig]);
  const filtered = useMemo(() => nodeTypes.filter((node) => [node.id, node.name, nodeName(node), categoryName(node.category)].filter(Boolean).join(" ").toLowerCase().includes(query.toLowerCase())), [nodeTypes, query]);

  useEffect(() => { void (async () => { try { const nodes = await apiClient.listNodeTypes(); setNodeTypes(nodes); setSelectedId(nodes[0]?.id ?? ""); } catch { toast("无法加载节点目录", "error"); } finally { setLoading(false); } })(); }, []);
  useEffect(() => { if (!selected) return; setManifest(emptyManifest()); setLastSavedAt(null); void loadManifest(selected.id); }, [selected?.id]);

  const loadManifest = async (nodeId: string) => {
    const request = ++manifestRequest.current;
    let next = emptyManifest();
    try { next = await apiClient.getNodeTypeManifest(nodeId); } catch { /* A missing override uses the default card. */ }
    if (activeNodeId.current === nodeId && manifestRequest.current === request) setManifest(next);
  };
  const updatePort = (direction: "inputs" | "outputs", id: string, patch: Partial<NodePortPresentation>) => setManifest((current) => ({ ...current, portPresentation: { ...current.portPresentation, [direction]: { ...current.portPresentation?.[direction], [id]: { ...current.portPresentation?.[direction]?.[id], ...patch } } } }));
  const updatePlacement = (key: string, value: "inline" | "panel") => setManifest((current) => ({ ...current, placements: { ...current.placements, [key]: value } }));
  const updateCardStyle = (patch: Partial<NodeCardStyle>) => setManifest((current) => ({ ...current, cardStyle: { ...current.cardStyle, ...patch } }));
  const updateSummaryTemplate = (patch: Partial<NodeSummaryTemplate>) => setManifest((current) => ({ ...current, summaryTemplate: { ...current.summaryTemplate, ...patch } }));
  const resetCardStyle = () => setManifest((current) => ({ ...current, cardStyle: undefined }));
  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await apiClient.saveNodeTypeManifest(selected.id, manifest);
      window.dispatchEvent(new CustomEvent("nodeflow:manifest-saved", { detail: { nodeTypeId: selected.id, manifest } }));
      await loadCanvasNodeTypes();
      setNodeTypes(await apiClient.listNodeTypes());
      setLastSavedAt(new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()));
      toast("节点展示清单已保存，并已同步到画布", "success");
      await loadManifest(selected.id);
    }
    catch (error) { toast(saveErrorMessage(error), "error"); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="grid h-full place-items-center text-sm text-muted">正在加载节点工作室…</div>;
  return <div className="node-studio grid h-full min-h-0 min-w-0 overflow-hidden">
    <div className="studio-picker col-span-full items-center gap-3 border-b border-border bg-surface px-4 py-3"><PanelsTopLeft size={16} className="shrink-0 text-primary" /><Select aria-label="选择预览节点" value={selectedId} onValueChange={(selectedValue) => setSelectedId(selectedValue)} className="min-w-0 flex-1 rounded-lg border border-border bg-raised px-3 py-2 text-xs">{nodeTypes.map((node) => <option key={node.id} value={node.id}>{nodeName(node)} · {node.id}</option>)}</Select></div>
    <aside className="studio-library flex min-h-0 min-w-0 flex-col border-r border-border bg-surface"><div className="border-b border-border/70 p-4"><div className="flex items-center gap-2"><PanelsTopLeft size={16} className="text-primary" /><h2 className="text-sm font-semibold">节点工作室</h2></div><p className="mt-1 text-[11px] text-muted">管理节点画布展示方式</p><div className="relative mt-3"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input aria-label="搜索节点" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索节点" className="w-full rounded-md border border-border bg-raised py-2 pl-8 pr-2 text-xs outline-none focus:border-primary" /></div></div><div className="min-h-0 flex-1 overflow-y-auto p-2">{filtered.map((node) => { const Icon = nodeIcon(node); return <button key={node.id} onClick={() => setSelectedId(node.id)} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${node.id === selectedId ? "bg-primary/12 text-text" : "hover:bg-raised text-text-secondary"}`}><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-raised" style={{ color: categoryColor(node.category) }}><Icon size={15} /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{nodeName(node)}</span><span className="mt-0.5 block truncate text-[10px] text-muted">{node.id}</span></span></button>; })}</div></aside>
    <main className="studio-preview flex min-h-0 min-w-0 flex-col overflow-hidden bg-canvas p-5"><div className="mx-auto flex h-full min-h-0 w-full max-w-[520px] flex-col"><div className="mb-5 flex shrink-0 items-center gap-2"><Eye size={16} className="shrink-0 text-primary" /><div><h1 className="text-sm font-semibold">画布预览</h1><p className="mt-0.5 text-[11px] leading-relaxed text-muted">展示清单保存后将应用到节点库与画布</p></div></div>{selected ? <NodePreview key={selected.id} node={selected} manifest={manifest} config={previewConfig} onConfigChange={(config) => setPreviewState({ nodeId: selected.id, config })} /> : <div className="text-sm text-muted">选择一个节点开始编辑</div>}</div></main>
    <aside className="studio-inspector min-h-0 min-w-0 overflow-hidden border-l border-border bg-surface">{editorNode && <StudioEditor node={editorNode} manifest={manifest} onPortChange={updatePort} onPlacementChange={updatePlacement} onCardStyleChange={updateCardStyle} onSummaryTemplateChange={updateSummaryTemplate} onCardStyleReset={resetCardStyle} onSave={() => void save()} saving={saving} lastSavedAt={lastSavedAt} />}</aside>
  </div>;
}

export function NodePreview({ node, manifest, config, onConfigChange }: { node: NodeType; manifest: NodeFormManifest; config?: Record<string, unknown>; onConfigChange?: (value: Record<string, unknown>) => void }) {
  const [localConfig, setLocalConfig] = useState(() => nodeConfigDefaults(node));
  const current = config ?? localConfig;
  const [selected, setSelected] = useState(false);
  const [httpProfiles, setHttpProfiles] = useState<HttpProfile[]>([]);
  const [draft, setDraft] = useState(() => JSON.stringify(current, null, 2));
  const [configError, setConfigError] = useState("");
  useEffect(() => { setDraft(JSON.stringify(current, null, 2)); setConfigError(""); }, [current]);
  useEffect(() => {
    let disposed = false;
    if (node.id === "http.request" || node.form?.groups.some((group) => group.fields.some((field) => field.control === "http_profile"))) {
      void apiClient.listHttpProfiles().then((profiles) => { if (!disposed) setHttpProfiles(profiles); }).catch(() => {});
    }
    return () => { disposed = true; };
  }, [node.id]);
  const update = (value: Record<string, unknown>) => onConfigChange ? onConfigChange(value) : setLocalConfig(value);
  const apply = () => {
    try {
      const value: unknown = JSON.parse(draft);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      update(value as Record<string, unknown>);
      setConfigError("");
    } catch { setConfigError("请输入有效的 JSON 对象。"); }
  };
  const instance = { ...createNodeInstance(node, "studio-preview", { x: 0, y: 0 }), config: current };
  return <section aria-label="节点卡片预览" className="flex min-h-0 flex-1 flex-col">
    <div className="preview-toolbar mb-4 flex shrink-0 items-center justify-between gap-3 text-[11px] leading-relaxed text-muted"><span>100% 大小 · 默认配置，可在下方调整</span><button type="button" aria-pressed={selected} onClick={() => setSelected((value) => !value)} className={`shrink-0 rounded-md border px-2 py-1 ${selected ? "border-primary/40 bg-primary/10 text-primary" : "border-border hover:text-text"}`}>选中状态</button></div>
    <div className="preview-card-stage min-h-0 flex-1 overflow-auto px-2 py-2"><div className="mx-auto w-fit"><NodeCard node={instance} nodeType={node} manifest={manifest} selected={selected} httpProfiles={httpProfiles} onConfigChange={(key, value) => update({ ...current, [key]: value })} /></div></div>
    <div className="preview-support mt-5 max-h-[60%] shrink-0 overflow-y-auto"><details className="rounded-lg border border-border/70 bg-surface px-3 py-2"><summary className="cursor-pointer text-xs text-text-secondary">预览配置</summary><p className="mt-2 text-[11px] leading-relaxed text-muted">调整示例值，查看内联字段、动态端口和摘要；仅用于本页预览。</p><textarea aria-label="预览配置 JSON" rows={7} value={draft} onChange={(event) => setDraft(event.target.value)} className="mt-2 w-full resize-y rounded border border-border bg-raised px-2 py-2 font-mono text-xs outline-none focus:border-primary" />{configError && <p role="alert" className="mt-1 text-[11px] text-danger">{configError}</p>}<div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => update(nodeConfigDefaults(node))} className="rounded px-2 py-1 text-[11px] text-muted hover:bg-raised">恢复默认配置</button><button type="button" onClick={apply} className="rounded bg-primary/15 px-2 py-1 text-[11px] text-primary hover:bg-primary/25">应用预览配置</button></div></details><div className="mt-3 rounded-lg border border-border/60 bg-surface p-4"><h3 className="text-xs font-semibold">展示说明</h3><p className="mt-2 text-[11px] leading-relaxed text-muted">修改名称、端口和卡片样式只影响展示，不改变节点的执行逻辑。</p></div></div>
  </section>;
}

function SummaryTemplateEditor({ template, onChange }: { template?: NodeSummaryTemplate | null; onChange: (patch: Partial<NodeSummaryTemplate>) => void }) {
  const input = "mt-1 w-full rounded border border-border bg-raised px-2 py-1.5 text-[11px] text-text outline-none focus:border-primary";
  return <div><p className="text-xs font-semibold">自定义摘要模板</p><p className="mt-1 text-[11px] leading-relaxed text-muted">使用 <code className="font-mono text-primary">{"{{field}}"}</code> 引用节点配置；主文案留空时使用内置摘要。</p><div className="mt-2 space-y-2"><label className="block text-[10px] text-muted">标记<input value={template?.badge ?? ""} onChange={(event) => onChange({ badge: event.target.value })} placeholder="例如：{{method}}" maxLength={32} className={input} /></label><label className="block text-[10px] text-muted">主文案<input value={template?.primary ?? ""} onChange={(event) => onChange({ primary: event.target.value })} placeholder="例如：{{url}}" maxLength={160} className={input} /></label><label className="block text-[10px] text-muted">次要文案<input value={template?.secondary ?? ""} onChange={(event) => onChange({ secondary: event.target.value })} placeholder="可选，例如：超时 {{timeout_seconds}} 秒" maxLength={240} className={input} /></label></div></div>;
}

function StudioEditor({ node, manifest, onPortChange, onPlacementChange, onCardStyleChange, onSummaryTemplateChange, onCardStyleReset, onSave, saving, lastSavedAt }: { node: NodeType; manifest: NodeFormManifest; onPortChange: (direction: "inputs" | "outputs", id: string, patch: Partial<NodePortPresentation>) => void; onPlacementChange: (key: string, value: "inline" | "panel") => void; onCardStyleChange: (patch: Partial<NodeCardStyle>) => void; onSummaryTemplateChange: (patch: Partial<NodeSummaryTemplate>) => void; onCardStyleReset: () => void; onSave: () => void; saving: boolean; lastSavedAt: string | null }) {
  const [section, setSection] = useState<"ports" | "fields" | "appearance">("ports");
  const renderPorts = (direction: "inputs" | "outputs", ports: Record<string, NodePort>) => <div className="space-y-3">{Object.entries(ports).map(([id, port]) => {
    const presentation = manifest.portPresentation?.[direction]?.[id] ?? {};
    const visibility = presentation.collapsed === undefined ? "auto" : presentation.collapsed ? "hidden" : "visible";
    return <section key={id} aria-label={`${id} 端口展示`} className="min-w-0 rounded-xl border border-border/60 bg-raised/25 p-3">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2"><code className="truncate text-xs font-semibold" title={id}>{id}</code><span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[10px] text-muted">{direction === "inputs" ? "输入" : port.category === "error" ? "错误输出" : "输出"}</span></div>
      <label className="block text-[11px] text-muted">显示名称<input aria-label={`${id} 显示名称`} value={presentation.displayName ?? port.displayName ?? ""} onChange={(event) => onPortChange(direction, id, { displayName: event.target.value })} placeholder={id} className="mt-1.5 w-full rounded-lg border border-border bg-raised px-2.5 py-2 text-xs text-text outline-none focus:border-primary" /></label>
      <div className="port-display-options mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-end gap-3">
        <div className="min-w-0"><span className="mb-1.5 block text-[11px] text-muted">顺序</span><NumberInput aria-label={`${id} 端口顺序`} value={presentation.order ?? 0} onValueChange={(value) => onPortChange(direction, id, { order: Number(value) })} className="w-full" /></div>
        <label className="block min-w-0 text-[11px] text-muted">画布显示<Select aria-label={`${id} 画布显示`} value={visibility} onValueChange={(selectedValue) => onPortChange(direction, id, { collapsed: selectedValue === "auto" ? undefined : selectedValue === "hidden" })} className="mt-1.5 w-full rounded-lg border border-border bg-raised px-2.5 py-2 text-xs text-text outline-none focus:border-primary"><option value="auto">自动</option><option value="visible">始终显示</option><option value="hidden">始终隐藏</option></Select></label>
      </div>
      {port.category === "error" && visibility === "auto" && <p className="mt-3 text-[11px] leading-relaxed text-muted">仅在节点选中或端口已连接时显示。</p>}
    </section>;
  })}</div>;
  const fields = node.form?.groups.flatMap((group) => group.fields) ?? [];
  return <div className="studio-editor flex h-full min-h-0 flex-col"><div className="border-b border-border/70 p-4"><div className="flex items-center gap-2"><SlidersHorizontal size={16} className="text-primary" /><div><h2 className="text-sm font-semibold">展示清单</h2><p className="mt-0.5 text-[10px] text-muted">{node.id}</p></div></div></div><div className="flex border-b border-border/70 px-3"><button onClick={() => setSection("ports")} className={`px-2.5 py-2 text-xs ${section === "ports" ? "bg-primary/12 text-primary" : "text-muted"}`}>端口</button><button onClick={() => setSection("fields")} className={`px-2.5 py-2 text-xs ${section === "fields" ? "bg-primary/12 text-primary" : "text-muted"}`}>内联字段</button><button onClick={() => setSection("appearance")} className={`px-2.5 py-2 text-xs ${section === "appearance" ? "bg-primary/12 text-primary" : "text-muted"}`}>外观</button></div><div className="studio-editor-body min-h-0 flex-1 overflow-y-auto p-4">{section === "ports" ? <>{renderPorts("inputs", node.inputs)}{Object.keys(node.inputs).length > 0 && Object.keys(node.outputs).length > 0 && <div className="my-4 border-t border-border/70" />}{renderPorts("outputs", node.outputs)}</> : section === "fields" ? fields.length === 0 ? <p className="text-xs text-muted">该节点没有声明表单字段。</p> : <div className="space-y-2">{fields.map((field) => <label key={field.key} className="flex items-center gap-2 rounded border border-border/70 px-3 py-2 text-xs"><span className="min-w-0 flex-1 truncate">{field.label ?? field.key}</span><Select value={manifest.placements?.[field.key] ?? field.placement ?? "panel"} onValueChange={(selectedValue) => onPlacementChange(field.key, selectedValue as "inline" | "panel")} className="rounded border border-border bg-raised px-1.5 py-1 text-[11px] text-text outline-none focus:border-primary"><option value="panel">仅配置面板</option><option value="inline">显示在节点内</option></Select></label>)}</div> : <div className="space-y-5"><div><div className="flex items-center gap-2 text-xs font-semibold"><Palette size={14} className="text-primary" />卡片主题色</div><p className="mt-1 text-[11px] leading-relaxed text-muted">控制节点标题和预览的强调色，不会改变执行行为。</p><div className="mt-3 flex flex-wrap gap-2">{ACCENT_OPTIONS.map((accent) => <button key={accent} type="button" aria-label={`主题色 ${accent}`} onClick={() => onCardStyleChange({ accent })} className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary ${manifest.cardStyle?.accent === accent ? "border-white ring-2 ring-primary" : "border-transparent"}`} style={{ backgroundColor: accent }} />)}</div></div><div><p className="text-xs font-semibold">信息密度</p><div className="mt-2 grid grid-cols-2 gap-2">{(["comfortable", "compact"] as const).map((density) => <button key={density} type="button" onClick={() => onCardStyleChange({ density })} className={`rounded border px-3 py-2 text-left text-xs transition-colors ${(manifest.cardStyle?.density ?? "comfortable") === density ? "border-primary bg-primary/12 text-text" : "border-border bg-raised text-text-secondary hover:border-border-hover"}`}><span className="block font-medium">{density === "comfortable" ? "舒展" : "紧凑"}</span><span className="mt-0.5 block text-[10px] text-muted">{density === "comfortable" ? "便于查看字段" : "节省画布空间"}</span></button>)}</div></div><div><p className="text-xs font-semibold">语义摘要</p><p className="mt-1 text-[11px] leading-relaxed text-muted">HTTP、循环、分组与 JSON 节点会从当前配置生成一行摘要。</p><div className="mt-2 grid grid-cols-2 gap-2">{(["auto", "hidden"] as const).map((summary) => <button key={summary} type="button" onClick={() => onCardStyleChange({ summary })} className={`rounded border px-3 py-2 text-left text-xs transition-colors ${(manifest.cardStyle?.summary ?? "auto") === summary ? "border-primary bg-primary/12 text-text" : "border-border bg-raised text-text-secondary hover:border-border-hover"}`}><span className="block font-medium">{summary === "auto" ? "自动显示" : "隐藏摘要"}</span><span className="mt-0.5 block text-[10px] text-muted">{summary === "auto" ? "保留关键状态" : "只显示端口和内联字段"}</span></button>)}</div></div><SummaryTemplateEditor template={manifest.summaryTemplate} onChange={onSummaryTemplateChange} />{manifest.cardStyle && <button type="button" onClick={onCardStyleReset} className="text-[11px] text-muted underline underline-offset-4 hover:text-text">恢复分类默认外观</button>}</div>}</div><div className="studio-save-bar shrink-0 border-t border-border/70 bg-surface p-3">{lastSavedAt && <p className="mb-2 text-center text-[10px] text-success">已保存并刷新画布 · {lastSavedAt}</p>}<button onClick={onSave} disabled={saving} className="flex h-8 w-full items-center justify-center gap-1.5 rounded bg-primary text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"><Save size={14} />{saving ? "正在保存…" : "保存展示清单"}</button></div></div>;
}
