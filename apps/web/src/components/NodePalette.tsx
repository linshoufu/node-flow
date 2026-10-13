import { useMemo, useState } from "react";
import { useWorkflowStore } from "@/store/workflow";

const CAT_COLORS: Record<string, string> = {
  schedule: "#fbbf24", webhook: "#60a5fa", http: "#34d399",
  assertion: "#fb7185", control: "#a78bfa", data: "#38bdf8",
  testing: "#f472b6", workflow: "#22d3ee",
};

function catColor(cat: string) {
  const key = cat?.toLowerCase() ?? "";
  for (const [k, v] of Object.entries(CAT_COLORS)) if (key.includes(k)) return v;
  return "#6366f1";
}

export function NodePalette() {
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const canvasScope = useWorkflowStore((s) => s.canvasScope);
  const addNode = useWorkflowStore((s) => s.addNode);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const reloadNodeTypes = useWorkflowStore((s) => s.loadNodeTypes);

  const categories = useMemo(() => {
    const cats: Record<string, typeof nodeTypes> = {};
    nodeTypes.forEach((t) => {
      if (canvasScope.length > 0 && t.group === "trigger") return;
      if (query && !t.id.toLowerCase().includes(query.toLowerCase()) && !(t.displayName ?? t.name).toLowerCase().includes(query.toLowerCase())) return;
      if (filter !== "all" && t.group !== filter && t.category !== filter) return;
      const cat = t.category || "其他";
      (cats[cat] ??= []).push(t);
    });
    return cats;
  }, [canvasScope.length, nodeTypes, query, filter]);

  return (
    <>
      <div className="px-3 py-2.5 border-b">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="search"
            placeholder="搜索节点名称或描述…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-raised text-xs rounded-md pl-8 pr-2 py-1.5 border border-border focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted/60"
          />
        </div>
      </div>
      <div className="flex gap-1 px-3 py-2 border-b overflow-x-auto">
        {[
          { k: "all", v: "全部" },
          { k: "trigger", v: "Trigger" },
          { k: "网络", v: "网络" },
          { k: "数据", v: "数据" },
          { k: "控制", v: "控制" },
        ].map((f) => (
          <button
            key={f.k}
            onClick={() => setFilter(f.k)}
            className={`text-[11px] px-2 py-0.5 rounded whitespace-nowrap transition ${
              filter === f.k
                ? "bg-primary/15 text-primary font-medium"
                : "text-muted hover:text-text hover:bg-raised"
            }`}
          >
            {f.v}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {Object.entries(categories).length === 0 ? (
          <div className="p-6 text-center text-xs text-muted">
            {query ? "没有匹配的节点" : "加载中…"}
          </div>
        ) : (
          Object.entries(categories).map(([cat, types]) => (
            <div key={cat}>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted sticky top-0 bg-surface border-b border-border/30 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: catColor(cat) }} />
                {cat}
                <span className="font-normal normal-case tracking-normal ml-auto">{types.length}</span>
              </div>
              {types.map((t) => {
                const color = catColor(t.category ?? "");
                return (
                  <button
                    key={t.id}
                    onClick={() => addNode(t, { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 })}
                    className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-raised/50 transition group border-b border-border/20 last:border-b-0"
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
                      style={{ background: `${color}18`, color }}
                    >
                      {(t.icon ?? "⚡").slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-text">{t.displayName ?? t.name}</div>
                      <div className="text-[10px] text-muted leading-relaxed mt-0.5 line-clamp-2">{t.description}</div>
                      {t.version && (
                        <span className="text-[9px] text-muted/60 mt-1 inline-block">v{t.version}</span>
                      )}
                    </div>
                    <span className="opacity-0 group-hover:opacity-100 text-muted text-sm shrink-0 transition-opacity">+</span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
      <div className="p-2 border-t text-center">
        <button
          onClick={() => reloadNodeTypes()}
          className="text-[10px] text-muted hover:text-text transition"
        >
          🔄 {nodeTypes.length} 个节点 · 刷新
        </button>
      </div>
    </>
  );
}
