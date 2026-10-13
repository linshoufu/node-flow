import { useEffect, useMemo, useState } from "react";
import { Eye, Palette, PanelsTopLeft, Save, Search, SlidersHorizontal } from "lucide-react";
import { apiClient } from "@/api/client";
import { useWorkflowStore } from "@/store/workflow";
import type { NodeCardStyle, NodeFormManifest, NodePort, NodePortPresentation, NodeSummaryTemplate, NodeType } from "@/types";
import { toast } from "./Toaster";

const categoryColor = (category: string) => {
  const value = category.toLowerCase();
  if (value.includes("trigger")) return "#75a7ff";
  if (value.includes("http") || value.includes("network")) return "#58d3aa";
  if (value.includes("assert")) return "#fb7e8c";
  if (value.includes("control")) return "#b498ff";
  if (value.includes("data")) return "#6bc8f8";
  return "#70a4ff";
};

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const loadCanvasNodeTypes = useWorkflowStore((state) => state.loadNodeTypes);
  const selected = useMemo(() => nodeTypes.find((node) => node.id === selectedId) ?? null, [nodeTypes, selectedId]);
  const filtered = useMemo(() => nodeTypes.filter((node) => [node.id, node.name, node.displayName, node.category].filter(Boolean).join(" ").toLowerCase().includes(query.toLowerCase())), [nodeTypes, query]);

  useEffect(() => { void (async () => { try { const nodes = await apiClient.listNodeTypes(); setNodeTypes(nodes); setSelectedId(nodes[0]?.id ?? ""); } catch { toast("无法加载节点目录", "error"); } finally { setLoading(false); } })(); }, []);
  useEffect(() => { if (!selected) return; setLastSavedAt(null); void loadManifest(selected.id); }, [selected?.id]);

  const loadManifest = async (nodeId: string) => {
    try { setManifest(await apiClient.getNodeTypeManifest(nodeId)); }
    catch { setManifest(emptyManifest()); }
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
  return <div className="grid h-full min-h-0 grid-cols-[260px_minmax(360px,1fr)_340px] overflow-hidden">
    <aside className="flex min-h-0 flex-col border-r border-border bg-surface"><div className="border-b border-border/70 p-4"><div className="flex items-center gap-2"><PanelsTopLeft size={16} className="text-primary" /><h2 className="text-sm font-semibold">节点工作室</h2></div><p className="mt-1 text-[11px] text-muted">管理节点画布展示方式</p><div className="relative mt-3"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索节点" className="w-full rounded-md border border-border bg-raised py-2 pl-8 pr-2 text-xs outline-none focus:border-primary" /></div></div><div className="min-h-0 flex-1 overflow-y-auto p-2">{filtered.map((node) => <button key={node.id} onClick={() => setSelectedId(node.id)} className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left ${node.id === selectedId ? "bg-primary/12 text-text" : "hover:bg-raised text-text-secondary"}`}><span className="h-2 w-2 rounded-full" style={{ background: categoryColor(node.category) }} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{node.displayName ?? node.name}</span><span className="block truncate text-[10px] text-muted">{node.id}</span></span></button>)}</div></aside>
    <main className="min-h-0 overflow-y-auto bg-canvas p-6"><div className="mx-auto max-w-[520px]"><div className="mb-5 flex items-center gap-2"><Eye size={16} className="text-primary" /><div><h1 className="text-sm font-semibold">画布预览</h1><p className="mt-0.5 text-[11px] text-muted">展示清单保存后将应用到节点库与画布</p></div></div>{selected ? <NodePreview node={selected} manifest={manifest} /> : <div className="text-sm text-muted">选择一个节点开始编辑</div>}<div className="mt-6 rounded-md border border-border/70 bg-surface p-4"><h3 className="text-xs font-semibold">展示层与执行层的边界</h3><p className="mt-2 text-[11px] leading-relaxed text-muted">这里保存端口文案、显示策略、内联字段、卡片外观和摘要模板。Python 节点类仍负责执行逻辑、端口契约与配置 Schema。</p></div></div></main>
    <aside className="min-h-0 overflow-y-auto border-l border-border bg-surface">{selected && <StudioEditor node={selected} manifest={manifest} onPortChange={updatePort} onPlacementChange={updatePlacement} onCardStyleChange={updateCardStyle} onSummaryTemplateChange={updateSummaryTemplate} onCardStyleReset={resetCardStyle} onSave={() => void save()} saving={saving} lastSavedAt={lastSavedAt} />}</aside>
  </div>;
}

function NodePreview({ node, manifest }: { node: NodeType; manifest: NodeFormManifest }) {
  const color = manifest.cardStyle?.accent ?? categoryColor(node.category);
  const compact = manifest.cardStyle?.density === "compact";
  const port = (direction: "inputs" | "outputs", id: string, source: NodePort) => {
    const presentation = manifest.portPresentation?.[direction]?.[id];
    const contextualError = direction === "outputs" && source.category === "error" && presentation?.collapsed === undefined;
    return { ...source, ...presentation, collapsed: contextualError ? true : (presentation?.collapsed ?? source.collapsed) };
  };
  const ordered = (direction: "inputs" | "outputs", values: Record<string, NodePort>) => Object.entries(values).sort(([left], [right]) => (manifest.portPresentation?.[direction]?.[left]?.order ?? 0) - (manifest.portPresentation?.[direction]?.[right]?.order ?? 0));
  const fields = node.form?.groups.flatMap((group) => group.fields).filter((field) => (manifest.placements?.[field.key] ?? field.placement) === "inline") ?? [];
  const visibleFields = fields.slice(0, 3);
  const hasSummary = (Boolean(manifest.summaryTemplate?.primary?.trim()) || ["http.request", "control.each_item", "data.group_items", "data.json_template"].includes(node.id)) && manifest.cardStyle?.summary !== "hidden";
  const previewBadge = manifest.summaryTemplate?.badge?.trim() || "摘要";
  const previewPrimary = manifest.summaryTemplate?.primary?.trim() || "根据当前节点配置自动生成";
  return <article className="mx-auto w-full max-w-[310px] overflow-visible rounded-md border border-border bg-surface shadow-[0_16px_38px_rgba(0,0,0,.34)]"><header className={`flex items-center gap-2 px-3 ${compact ? "h-8" : "h-10"}`} style={{ background: `${color}20`, borderBottom: `1px solid ${color}42` }}><span className="h-2 w-2 rounded-full" style={{ background: color }} /><h2 className="min-w-0 flex-1 truncate text-xs font-semibold">{node.displayName ?? node.name}</h2><span className="text-[9px] text-muted">{node.category}</span></header><div className={compact ? "py-0" : "py-1"}>{ordered("inputs", node.inputs).map(([id, value]) => <PreviewPort key={id} id={id} port={port("inputs", id, value)} direction="input" compact={compact} />)}{hasSummary && <div className={`mx-3 border-y border-border/60 text-[10px] text-text-secondary ${compact ? "py-1" : "py-1.5"}`}><span className="rounded bg-primary/12 px-1.5 py-0.5 font-semibold text-primary">{previewBadge}</span><span className="ml-1.5">{previewPrimary}</span>{manifest.summaryTemplate?.secondary?.trim() && <p className="mt-1 truncate text-muted">{manifest.summaryTemplate.secondary}</p>}</div>}{visibleFields.map((field) => <label key={field.key} className={`flex items-center gap-2 px-3 text-[11px] text-muted ${compact ? "py-1" : "py-1.5"}`}><span className="w-[42%] truncate">{field.label ?? field.key}</span><span className="h-6 flex-1 rounded border border-border bg-raised" /></label>)}{fields.length > 3 && <p className="px-3 py-1.5 text-center text-[10px] text-muted">其余 {fields.length - 3} 项在右侧配置</p>}{ordered("outputs", node.outputs).map(([id, value]) => <PreviewPort key={id} id={id} port={port("outputs", id, value)} direction="output" compact={compact} />)}</div></article>;
}

function PreviewPort({ id, port, direction, compact }: { id: string; port: NodePort; direction: "input" | "output"; compact: boolean }) { if (port.collapsed) return null; return <div className={`flex items-center gap-2 px-3 text-[11px] ${compact ? "min-h-6" : "min-h-7"} ${direction === "output" ? "justify-end text-right" : ""}`}><span className={`h-2.5 w-2.5 rounded-full ${direction === "input" ? "bg-muted" : "bg-success"}`} /><span className="truncate text-text-secondary">{port.displayName ?? id}{port.required && <span className="ml-1 text-danger">*</span>}</span></div>; }

function SummaryTemplateEditor({ template, onChange }: { template?: NodeSummaryTemplate | null; onChange: (patch: Partial<NodeSummaryTemplate>) => void }) {
  const input = "mt-1 w-full rounded border border-border bg-raised px-2 py-1.5 text-[11px] text-text outline-none focus:border-primary";
  return <div><p className="text-xs font-semibold">自定义摘要模板</p><p className="mt-1 text-[11px] leading-relaxed text-muted">使用 <code className="font-mono text-primary">{"{{field}}"}</code> 引用节点配置；主文案留空时使用内置摘要。</p><div className="mt-2 space-y-2"><label className="block text-[10px] text-muted">标记<input value={template?.badge ?? ""} onChange={(event) => onChange({ badge: event.target.value })} placeholder="例如：{{method}}" maxLength={32} className={input} /></label><label className="block text-[10px] text-muted">主文案<input value={template?.primary ?? ""} onChange={(event) => onChange({ primary: event.target.value })} placeholder="例如：{{url}}" maxLength={160} className={input} /></label><label className="block text-[10px] text-muted">次要文案<input value={template?.secondary ?? ""} onChange={(event) => onChange({ secondary: event.target.value })} placeholder="可选，例如：超时 {{timeout_seconds}} 秒" maxLength={240} className={input} /></label></div></div>;
}

function StudioEditor({ node, manifest, onPortChange, onPlacementChange, onCardStyleChange, onSummaryTemplateChange, onCardStyleReset, onSave, saving, lastSavedAt }: { node: NodeType; manifest: NodeFormManifest; onPortChange: (direction: "inputs" | "outputs", id: string, patch: Partial<NodePortPresentation>) => void; onPlacementChange: (key: string, value: "inline" | "panel") => void; onCardStyleChange: (patch: Partial<NodeCardStyle>) => void; onSummaryTemplateChange: (patch: Partial<NodeSummaryTemplate>) => void; onCardStyleReset: () => void; onSave: () => void; saving: boolean; lastSavedAt: string | null }) {
  const [section, setSection] = useState<"ports" | "fields" | "appearance">("ports");
  const renderPorts = (direction: "inputs" | "outputs", ports: Record<string, NodePort>) => <div className="space-y-3">{Object.entries(ports).map(([id, port]) => { const presentation = manifest.portPresentation?.[direction]?.[id] ?? {}; const visibility = presentation.collapsed === undefined ? "auto" : presentation.collapsed ? "hidden" : "visible"; return <div key={id} className="border-b border-border/60 pb-3 last:border-0"><div className="mb-2 flex items-center gap-2"><span className="text-[11px] font-semibold">{id}</span><span className="text-[10px] text-muted">{direction === "inputs" ? "输入" : port.category === "error" ? "错误输出" : "输出"}</span></div><label className="block text-[10px] text-muted">显示名称<input value={presentation.displayName ?? port.displayName ?? ""} onChange={(event) => onPortChange(direction, id, { displayName: event.target.value })} placeholder={id} className="mt-1 w-full rounded border border-border bg-raised px-2 py-1.5 text-xs text-text outline-none focus:border-primary" /></label><div className="mt-2 flex items-center gap-2"><label className="flex items-center gap-1.5 text-[10px] text-muted">顺序<input type="number" value={presentation.order ?? 0} onChange={(event) => onPortChange(direction, id, { order: Number(event.target.value) })} className="w-14 rounded border border-border bg-raised px-1.5 py-1 text-xs text-text outline-none focus:border-primary" /></label><label className="ml-auto flex items-center gap-1.5 text-[10px] text-muted">画布显示<select value={visibility} onChange={(event) => onPortChange(direction, id, { collapsed: event.target.value === "auto" ? undefined : event.target.value === "hidden" })} className="rounded border border-border bg-raised px-1.5 py-1 text-[10px] text-text outline-none focus:border-primary"><option value="auto">自动</option><option value="visible">始终显示</option><option value="hidden">始终隐藏</option></select></label></div>{port.category === "error" && visibility === "auto" && <p className="mt-2 text-[10px] leading-relaxed text-muted">自动模式下，仅在节点选中或端口已连接时显示。</p>}</div>; })}</div>;
  const fields = node.form?.groups.flatMap((group) => group.fields) ?? [];
  return <div className="flex min-h-full flex-col"><div className="border-b border-border/70 p-4"><div className="flex items-center gap-2"><SlidersHorizontal size={16} className="text-primary" /><div><h2 className="text-sm font-semibold">展示清单</h2><p className="mt-0.5 text-[10px] text-muted">{node.id}</p></div></div></div><div className="flex border-b border-border/70 px-3"><button onClick={() => setSection("ports")} className={`px-2.5 py-2 text-xs ${section === "ports" ? "bg-primary/12 text-primary" : "text-muted"}`}>端口</button><button onClick={() => setSection("fields")} className={`px-2.5 py-2 text-xs ${section === "fields" ? "bg-primary/12 text-primary" : "text-muted"}`}>内联字段</button><button onClick={() => setSection("appearance")} className={`px-2.5 py-2 text-xs ${section === "appearance" ? "bg-primary/12 text-primary" : "text-muted"}`}>外观</button></div><div className="flex-1 p-4">{section === "ports" ? <>{renderPorts("inputs", node.inputs)}<div className="my-4 border-t border-border/70" />{renderPorts("outputs", node.outputs)}</> : section === "fields" ? fields.length === 0 ? <p className="text-xs text-muted">该节点没有声明表单字段。</p> : <div className="space-y-2">{fields.map((field) => <label key={field.key} className="flex items-center gap-2 rounded border border-border/70 px-3 py-2 text-xs"><span className="min-w-0 flex-1 truncate">{field.label ?? field.key}</span><select value={manifest.placements?.[field.key] ?? field.placement ?? "panel"} onChange={(event) => onPlacementChange(field.key, event.target.value as "inline" | "panel")} className="rounded border border-border bg-raised px-1.5 py-1 text-[11px] text-text outline-none focus:border-primary"><option value="panel">仅配置面板</option><option value="inline">显示在节点内</option></select></label>)}</div> : <div className="space-y-5"><div><div className="flex items-center gap-2 text-xs font-semibold"><Palette size={14} className="text-primary" />卡片主题色</div><p className="mt-1 text-[11px] leading-relaxed text-muted">控制节点标题和预览的强调色，不会改变执行行为。</p><div className="mt-3 flex flex-wrap gap-2">{ACCENT_OPTIONS.map((accent) => <button key={accent} type="button" aria-label={`主题色 ${accent}`} onClick={() => onCardStyleChange({ accent })} className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary ${manifest.cardStyle?.accent === accent ? "border-white ring-2 ring-primary" : "border-transparent"}`} style={{ backgroundColor: accent }} />)}</div></div><div><p className="text-xs font-semibold">信息密度</p><div className="mt-2 grid grid-cols-2 gap-2">{(["comfortable", "compact"] as const).map((density) => <button key={density} type="button" onClick={() => onCardStyleChange({ density })} className={`rounded border px-3 py-2 text-left text-xs transition-colors ${manifest.cardStyle?.density === density ? "border-primary bg-primary/12 text-text" : "border-border bg-raised text-text-secondary hover:border-border-hover"}`}><span className="block font-medium">{density === "comfortable" ? "舒展" : "紧凑"}</span><span className="mt-0.5 block text-[10px] text-muted">{density === "comfortable" ? "便于查看字段" : "节省画布空间"}</span></button>)}</div></div><div><p className="text-xs font-semibold">语义摘要</p><p className="mt-1 text-[11px] leading-relaxed text-muted">HTTP、循环、分组与 JSON 节点会从当前配置生成一行摘要。</p><div className="mt-2 grid grid-cols-2 gap-2">{(["auto", "hidden"] as const).map((summary) => <button key={summary} type="button" onClick={() => onCardStyleChange({ summary })} className={`rounded border px-3 py-2 text-left text-xs transition-colors ${(manifest.cardStyle?.summary ?? "auto") === summary ? "border-primary bg-primary/12 text-text" : "border-border bg-raised text-text-secondary hover:border-border-hover"}`}><span className="block font-medium">{summary === "auto" ? "自动显示" : "隐藏摘要"}</span><span className="mt-0.5 block text-[10px] text-muted">{summary === "auto" ? "保留关键状态" : "只显示端口和内联字段"}</span></button>)}</div></div><SummaryTemplateEditor template={manifest.summaryTemplate} onChange={onSummaryTemplateChange} />{manifest.cardStyle && <button type="button" onClick={onCardStyleReset} className="text-[11px] text-muted underline underline-offset-4 hover:text-text">恢复分类默认外观</button>}</div>}</div><div className="sticky bottom-0 border-t border-border/70 bg-surface p-3">{lastSavedAt && <p className="mb-2 text-center text-[10px] text-success">已保存并刷新画布 · {lastSavedAt}</p>}<button onClick={onSave} disabled={saving} className="flex h-8 w-full items-center justify-center gap-1.5 rounded bg-primary text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"><Save size={14} />{saving ? "正在保存…" : "保存展示清单"}</button></div></div>;
}
