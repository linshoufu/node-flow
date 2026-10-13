import { useMemo, useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import { useWorkflowStore } from "@/store/workflow";
import { categoryColor, categoryName, nodeDescription, nodeIcon, nodeName } from "@/lib/nodePresentation";
const CATEGORY_ORDER = ["触发", "网络", "数据", "控制", "逻辑", "断言", "结果", "工具", "子流程"];

export function NodePalette() {
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const canvasScope = useWorkflowStore((s) => s.canvasScope);
  const addNode = useWorkflowStore((s) => s.addNode);
  const reload = useWorkflowStore((s) => s.loadNodeTypes);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部");
  const categories = useMemo(() => {
    const result: Record<string, typeof nodeTypes> = {};
    const search = query.trim().toLowerCase();
    for (const node of nodeTypes) {
      if (canvasScope.length && node.group === "trigger") continue;
      const category = categoryName(node.category || "其他");
      if (filter !== "全部" && category !== filter) continue;
      if (search && ![node.id, node.name, nodeName(node), nodeDescription(node)].join(" ").toLowerCase().includes(search)) continue;
      (result[category] ??= []).push(node);
    }
    return result;
  }, [canvasScope.length, nodeTypes, query, filter]);
  return <>
    <header className="px-4 pb-3 pt-4">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">节点库</h2><span className="text-[11px] text-muted">{nodeTypes.length} 个节点</span></div>
      <div className="relative"><Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input aria-label="搜索节点" type="search" placeholder="搜索名称或功能" value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-lg border border-border/80 bg-raised/70 py-2 pl-8 pr-2 text-xs outline-none focus:border-primary placeholder:text-muted" /></div>
    </header>
    <nav aria-label="节点分类" className="flex gap-1 overflow-x-auto border-y border-border/50 px-3 py-2">
      {["全部", "触发", "网络", "数据", "控制"].map((category) => <button key={category} aria-pressed={filter === category} onClick={() => setFilter(category)} className={`rounded-md px-2 py-1 text-[11px] whitespace-nowrap transition ${filter === category ? "bg-primary/15 font-medium text-primary" : "text-text-secondary hover:bg-raised"}`}>{category}</button>)}
    </nav>
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {Object.entries(categories).length === 0 ? <p className="px-3 py-8 text-center text-xs text-muted">{nodeTypes.length ? "没有匹配的节点" : "正在加载节点…"}</p> : Object.entries(categories).sort(([left], [right]) => (CATEGORY_ORDER.includes(left) ? CATEGORY_ORDER.indexOf(left) : CATEGORY_ORDER.length) - (CATEGORY_ORDER.includes(right) ? CATEGORY_ORDER.indexOf(right) : CATEGORY_ORDER.length)).map(([category, nodes]) => <section key={category}>
        <div className="flex items-center gap-2 px-2 pb-2 pt-4 text-[11px] font-medium text-muted"><span className="h-1.5 w-1.5 rounded-full" style={{ background: categoryColor(category) }} />{category}<span className="ml-auto text-[10px]">{nodes.length}</span></div>
        {nodes.map((node) => {
          const Icon = nodeIcon(node);
          const color = categoryColor(node.category);
          return <button key={node.id} title={`${nodeName(node)} · ${nodeDescription(node)}`} onClick={() => addNode(node, { x: 140 + Math.random() * 160, y: 140 + Math.random() * 160 })} className="group mb-1 flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2 py-2.5 text-left transition hover:border-border hover:bg-raised/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `${color}16`, color }}><Icon size={17} strokeWidth={1.8} /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{nodeName(node)}</span><span className="mt-1 block truncate text-[11px] text-muted">{nodeDescription(node)}</span></span>
            <Plus size={13} className="shrink-0 text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
          </button>;
        })}
      </section>)}
    </div>
    <footer className="border-t border-border/50 p-2"><button onClick={() => void reload()} className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-[11px] text-text-secondary hover:bg-raised hover:text-text"><RefreshCw size={12} />刷新节点库</button></footer>
  </>;
}
