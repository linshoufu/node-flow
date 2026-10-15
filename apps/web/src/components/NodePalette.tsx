import { Fragment, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { apiClient } from "@/api/client";
import type { NodeTemplate } from "@/types";
import { Blocks, GitBranch, LayoutTemplate, Plus, RefreshCw, Search } from "lucide-react";
import { getActiveGraph, useWorkflowStore } from "@/store/workflow";
import { categoryColor, categoryName, nodeDescription, nodeIcon, nodeName } from "@/lib/nodePresentation";
import { LibraryAssetActions, LibraryTrash } from "./LibraryAssetActions";
import { templateDependencyIssue } from "@/lib/templateDependencies";
const CATEGORY_ORDER = ["触发", "网络", "数据", "控制", "逻辑", "断言", "结果", "工具", "子流程"];
type LibraryTab = "nodes" | "presets" | "templates";

export function templateUnavailable(template: NodeTemplate, graphEmpty: boolean, inBody: boolean, emptyBody: boolean) {
  if (template.kind === "workflow" && (!graphEmpty || inBody)) return "请在空白工作流中添加";
  if (template.kind === "subflow" && (!inBody || !emptyBody)) return "请在空白循环体中添加";
  return "";
}

function LibraryItem({ name, description, icon: Icon, color, disabledReason, onClick }: { name: string; description: string; icon: ComponentType<{ size?: number; strokeWidth?: number }>; color: string; disabledReason?: string; onClick: () => void }) {
  return <button type="button" disabled={!!disabledReason} title={disabledReason || `${name} · ${description}`} onClick={onClick} className="group mb-1 flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2 py-2.5 text-left transition enabled:hover:border-border enabled:hover:bg-raised/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-55">
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `${color}16`, color }}><Icon size={17} strokeWidth={1.8} /></span>
    <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{name}</span><span className={`mt-1 block truncate text-[11px] ${disabledReason ? "text-amber-400/80" : "text-muted"}`}>{disabledReason || description}</span></span>
    <Plus size={13} className="shrink-0 text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
  </button>;
}

export function NodePalette({ onAdded, onClose }: { onAdded?: () => void; onClose?: () => void }) {
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const canvasScope = useWorkflowStore((s) => s.canvasScope);
  const addNode = useWorkflowStore((s) => s.addNode);
  const reload = useWorkflowStore((s) => s.loadNodeTypes);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<LibraryTab>("nodes");
  const [filter, setFilter] = useState("全部");
  const [templates, setTemplates] = useState<NodeTemplate[]>([]);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const workflow = useWorkflowStore((state) => state.workflow);
  const [templateError, setTemplateError] = useState("");
  const [showLegacy, setShowLegacy] = useState(false);
  const insertTemplate = useWorkflowStore((s) => s.insertTemplate);
  const graphEmpty = useWorkflowStore((s) => s.workflow.nodes.length === 0);
  const emptyBody = useWorkflowStore((s) => getActiveGraph(s.workflow, s.canvasScope).nodes.every((node) => ["control.loop_input", "control.loop_output"].includes(node.type)));
  useEffect(() => { let active = true; setTemplateError(""); apiClient.listNodeTemplates().then((items) => { if (active) setTemplates(items); }).catch(() => { if (active) setTemplateError("预设与模板加载失败，请刷新节点库"); }); return () => { active = false; }; }, [nodeTypes, libraryRevision]);
  useEffect(() => { const changed = () => setLibraryRevision((value) => value + 1); window.addEventListener("nodeflow:library-changed", changed); return () => window.removeEventListener("nodeflow:library-changed", changed); }, []);
  const categories = useMemo(() => {
    const result: Record<string, typeof nodeTypes> = {};
    const search = query.trim().toLowerCase();
    for (const node of nodeTypes) {
      if (!showLegacy && node.tags?.includes("legacy")) continue;
      if (canvasScope.length && node.group === "trigger") continue;
      const category = categoryName(node.category || "其他");
      if (filter !== "全部" && category !== filter) continue;
      if (search && ![node.id, node.name, nodeName(node), nodeDescription(node)].join(" ").toLowerCase().includes(search)) continue;
      (result[category] ??= []).push(node);
    }
    return result;
  }, [canvasScope.length, nodeTypes, query, filter, showLegacy]);
  const assets = templates.filter((item) => (tab === "presets" ? item.kind === "node" : item.kind !== "node") && `${item.name} ${item.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const count = tab === "nodes" ? Object.values(categories).flat().length : assets.length;
  return <>
    <header className="px-4 pb-3 pt-4">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">节点库</h2><span className="text-[11px] text-muted">{count} 项</span>{onClose && <button type="button" onClick={onClose} aria-label="收起节点库" className="rounded px-2 text-muted hover:text-text">×</button>}</div>
      <div role="tablist" aria-label="节点库内容" onKeyDown={(event) => { const keys = ["ArrowLeft", "ArrowRight", "Home", "End"]; if (!keys.includes(event.key)) return; event.preventDefault(); const tabs: LibraryTab[] = ["nodes", "presets", "templates"]; const current = tabs.indexOf(tab); const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (current + (event.key === "ArrowRight" ? 1 : 2)) % 3; setTab(tabs[next]); event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus(); }} className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-canvas/60 p-1">{([["nodes", "节点"], ["presets", "预设"], ["templates", "模板"]] as const).map(([value, name]) => <button key={value} role="tab" tabIndex={tab === value ? 0 : -1} id={`library-tab-${value}`} aria-controls="library-content" aria-selected={tab === value} onClick={() => setTab(value)} className={`h-7 rounded-md text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${tab === value ? "bg-primary/15 font-medium text-primary" : "text-muted hover:bg-raised"}`}>{name}</button>)}</div>
      <div className="relative"><Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input autoFocus aria-label="搜索节点库" type="search" placeholder={`搜索${tab === "nodes" ? "节点" : tab === "presets" ? "预设" : "模板"}`} value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-lg border border-border/80 bg-raised/70 py-2 pl-8 pr-2 text-xs outline-none focus:border-primary placeholder:text-muted" /></div>
    </header>
    {tab === "nodes" && <nav aria-label="节点分类" className="flex gap-1 overflow-x-auto border-y border-border/50 px-3 py-2">{["全部", "触发", "网络", "数据", "控制"].map((category) => <button key={category} aria-pressed={filter === category} onClick={() => setFilter(category)} className={`whitespace-nowrap rounded-md px-2 py-1 text-[11px] ${filter === category ? "bg-primary/15 font-medium text-primary" : "text-text-secondary hover:bg-raised"}`}>{category}</button>)}</nav>}
    <div role="tabpanel" id="library-content" aria-labelledby={`library-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {tab === "nodes" ? Object.keys(categories).length ? Object.entries(categories).sort(([left], [right]) => (CATEGORY_ORDER.includes(left) ? CATEGORY_ORDER.indexOf(left) : CATEGORY_ORDER.length) - (CATEGORY_ORDER.includes(right) ? CATEGORY_ORDER.indexOf(right) : CATEGORY_ORDER.length)).map(([category, nodes]) => <section key={category}><div className="flex items-center gap-2 px-2 pb-2 pt-4 text-[11px] font-medium text-muted"><span className="h-1.5 w-1.5 rounded-full" style={{ background: categoryColor(category) }} />{category}<span className="ml-auto text-[10px]">{nodes.length}</span></div>{nodes.map((node) => <LibraryItem key={node.id} name={nodeName(node)} description={nodeDescription(node)} icon={nodeIcon(node)} color={categoryColor(node.category)} onClick={() => { addNode(node, { x: 140 + Math.random() * 160, y: 140 + Math.random() * 160 }); onAdded?.(); }} />)}</section>) : <p className="px-3 py-8 text-center text-xs text-muted">没有匹配的节点</p> : <>
        <p className="px-2 py-3 text-[11px] leading-relaxed text-muted">{tab === "presets" ? "已填好常用配置的单个节点，添加后可修改。" : "包含多个节点和连线的流程组合。"}</p>
        {templateError ? <p role="alert" className="p-2 text-xs text-danger">{templateError}</p> : assets.length ? assets.map((template, index) => { const node = template.node && nodeTypes.find((item) => item.id === template.node?.type); return <Fragment key={template.id}>{(index === 0 || (assets[index - 1].source === "user") !== (template.source === "user")) && <h3 className="px-2 pb-2 pt-3 text-[11px] font-medium text-muted">{template.source === "user" ? "我的" : "节点包"}{tab === "presets" ? "预设" : "模板"}</h3>}<div className="flex items-center"><div className="min-w-0 flex-1"><LibraryItem name={template.name} description={tab === "presets" ? (node ? nodeName(node) : "节点预设") : template.kind === "subflow" ? "循环体模板" : "工作流模板"} icon={node ? nodeIcon(node) : template.kind === "subflow" ? GitBranch : template.kind === "workflow" ? LayoutTemplate : Blocks} color={node ? categoryColor(node.category) : "#60a5fa"} disabledReason={templateUnavailable(template, graphEmpty, !!canvasScope.length, emptyBody) || (template.kind !== "workflow" ? templateDependencyIssue(template, workflow) : "")} onClick={() => { insertTemplate(template); onAdded?.(); }} /></div><LibraryAssetActions asset={template} /></div></Fragment>; }) : <p className="px-3 py-8 text-center text-xs text-muted">没有匹配的{tab === "presets" ? "预设" : "模板"}</p>}
      </>}
    </div>
    <footer className="border-t border-border/50 p-2">{tab !== "nodes" && <><p className="px-2 pb-1 text-[10px] leading-relaxed text-muted">在节点配置面板保存预设，在工作流设置或循环体面板保存模板。</p><LibraryTrash /></>}{tab === "nodes" && <label className="mb-1 flex items-center gap-2 px-2 text-[10px] text-muted"><input type="checkbox" checked={showLegacy} onChange={(event) => setShowLegacy(event.target.checked)} />显示旧版兼容节点</label>}<button onClick={() => void reload()} className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-[11px] text-text-secondary hover:bg-raised hover:text-text"><RefreshCw size={12} />刷新节点库</button></footer>
  </>;
}
