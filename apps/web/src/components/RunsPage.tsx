import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, LayoutDashboard, ListTree, LoaderCircle, RefreshCw, RotateCcw, Square, X } from "lucide-react";
import { apiClient } from "@/api/client";
import { useRunsStore } from "@/store/runs";
import { getActiveGraph, useWorkflowStore } from "@/store/workflow";
import type { RunEvent, RunHistoryStatusFilter, RunRecord, WorkflowDocument } from "@/types";
import { findRunNodeScope } from "@/lib/runCanvas";
import { nodeName } from "@/lib/nodePresentation";
import { RunCanvas } from "./RunCanvas";
import { EventInspector, RunDetails, StatusBadge, StatusDot, formatTime, modeName, preferredEvent, shortId } from "./RunDetails";
import { toast } from "./Toaster";

export function RunsPage() {
  const workflow = useWorkflowStore((state) => state.workflow);
  const state = useRunsStore();
  const [actionPending, setActionPending] = useState(false);
  const refresh = () => void Promise.all([state.refresh(), state.refreshDetail()]);
  const action = async (kind: "cancel" | "retry") => {
    const run = state.activeRun;
    if (!run || actionPending) return;
    setActionPending(true);
    try {
      const result = kind === "cancel" ? await apiClient.cancelRun(run.id) : await apiClient.retryRun(run.id);
      if (kind === "retry") state.acceptRun(result); else await state.refreshDetail();
      toast(kind === "retry" ? "已创建重试运行" : "已请求取消运行", "success");
    } catch { toast(kind === "retry" ? "无法重试该运行" : "无法取消该运行", "error"); }
    finally { setActionPending(false); }
  };
  return <main aria-label="运行记录页面" className="runs-page flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 pt-2">
    <header className="workbench-surface flex shrink-0 flex-wrap items-center gap-3 rounded-xl px-4 py-3">
      <div className="min-w-0 flex-1"><h1 className="text-sm font-semibold">运行记录</h1><p className="mt-1 truncate text-xs text-muted">{workflow.name || "当前工作流"}</p></div>
      <label className="flex items-center gap-2 text-xs text-muted">状态<select aria-label="筛选运行状态" value={state.status} onChange={(event) => state.setStatus(event.target.value as RunHistoryStatusFilter)} className="rounded-lg border border-border bg-canvas px-2 py-1.5 text-text">
        <option value="all">全部状态</option><option value="failed">失败</option><option value="succeeded">已完成</option><option value="running">运行中</option><option value="queued">队列中</option><option value="cancelled">已取消</option>
      </select></label>
      <button type="button" onClick={refresh} disabled={state.loading} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-raised hover:text-text disabled:opacity-40" aria-label="刷新运行记录"><RefreshCw size={14} className={state.loading ? "animate-spin" : ""} />刷新</button>
    </header>
    {state.error && <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{state.error}</div>}
    {state.detailError && <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{state.detailError}</div>}
    <div className="run-history-layout grid min-h-0 flex-1 gap-3">
      <aside aria-label="运行历史" className="workbench-surface flex min-h-0 flex-col overflow-hidden rounded-xl">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!state.runs.length ? <p className="px-4 py-8 text-center text-xs text-muted">{state.loading ? "正在加载运行记录…" : !workflow.id ? "请先打开一个工作流" : "没有符合条件的运行记录"}</p> : state.runs.map((run) => <button type="button" key={run.id} onClick={() => void state.selectRun(run)} aria-pressed={state.activeRun?.id === run.id} className={`w-full border-b border-border/45 px-4 py-3 text-left ${state.activeRun?.id === run.id ? "bg-primary/10" : "hover:bg-raised/60"}`}>
            <div className="flex items-center gap-2"><StatusDot status={run.status} /><span className="min-w-0 flex-1 truncate text-xs font-medium">{modeName(run.execution_mode)}</span><span className="font-mono text-[10px] text-muted">#{shortId(run.id)}</span></div>
            <div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={run.status} /><span className="text-[10px] text-muted">v{run.workflow_version}</span></div>
            <div className="mt-2 text-[10px] text-muted">{formatTime(run.created_at)}</div>
          </button>)}
        </div>
        <footer className="flex shrink-0 items-center justify-between border-t border-border/60 px-2 py-1 text-[10px] text-muted"><button type="button" className="island-button" aria-label="上一页运行" disabled={!state.page || state.loading} onClick={() => state.setPage(state.page - 1)}><ChevronLeft size={14} /></button>第 {state.page + 1} 页<button type="button" className="island-button" aria-label="下一页运行" disabled={!state.hasMore || state.loading} onClick={() => state.setPage(state.page + 1)}><ChevronRight size={14} /></button></footer>
      </aside>
      <section className="workbench-surface flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl" aria-label="运行详情">
        {!state.activeRun ? <div className="grid flex-1 place-items-center p-6 text-sm text-muted">选择一次运行查看详情</div> : <>
          <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2.5">
            <StatusBadge status={state.activeRun.status} /><span className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={state.activeRun.id}>#{shortId(state.activeRun.id)} · 工作流 v{state.activeRun.workflow_version}</span>
            {["queued", "running"].includes(state.activeRun.status) && <button type="button" onClick={() => void action("cancel")} disabled={actionPending || Boolean(state.activeRun.cancel_requested_at)} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-warning hover:bg-raised disabled:opacity-40"><Square size={12} />{state.activeRun.cancel_requested_at ? "正在取消" : "取消运行"}</button>}
            {["failed", "cancelled"].includes(state.activeRun.status) && (!state.activeRun.execution_mode || state.activeRun.execution_mode === "manual") && <button type="button" onClick={() => void action("retry")} disabled={actionPending} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-primary hover:bg-raised disabled:opacity-40"><RotateCcw size={13} />重试</button>}
          </header>
          <RunView key={state.activeRun.id} run={state.activeRun} events={state.events} workflow={state.document} loading={state.loadingDetail} documentError={state.documentError ?? state.detailError} />
        </>}
      </section>
    </div>
  </main>;
}

function RunView({ run, events, workflow, loading, documentError }: { run: RunRecord; events: RunEvent[]; workflow: WorkflowDocument | null; loading: boolean; documentError: string | null }) {
  const catalog = useWorkflowStore((state) => state.nodeTypes);
  const [view, setView] = useState<"canvas" | "data">("canvas");
  const [selection, setSelection] = useState<{ nodeId: string; scope: string[] } | null>(null);
  const [eventId, setEventId] = useState<number | null>(null);
  const chosenEvent = events.find((event) => event.id === eventId) ?? preferredEvent(events);
  const inspectNode = useMemo(() => {
    if (!selection) return null;
    const matched = events.filter((event) => event.node_id === selection.nodeId &&
      event.scope.filter((part) => !part.startsWith("iteration:")).join("/") === selection.scope.filter((part) => !part.startsWith("iteration:")).join("/"));
    const latest = matched.at(-1);
    if (!latest) return null;
    return { ...latest, payload: Object.assign({}, ...matched.filter((event) => event.scope.join("/") === latest.scope.join("/")).map((event) => event.payload)) };
  }, [events, selection]);
  const path = workflow && selection ? findRunNodeScope(workflow, selection.nodeId, selection.scope) : null;
  const node = workflow && selection ? getActiveGraph(workflow, path ?? []).nodes.find((node) => node.id === selection.nodeId) : null;
  const type = node ? catalog.find((type) => type.id === node.type) : null;
  const name = node?.label || (type ? nodeName(type) : node?.type);
  return <div className="flex min-h-0 flex-1 flex-col">
    <nav className="flex shrink-0 items-center gap-1 border-b border-border/60 px-3 py-2" aria-label="运行详情视图" role="tablist">
      <button type="button" role="tab" aria-selected={view === "canvas"} onClick={() => setView("canvas")} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${view === "canvas" ? "bg-primary/15 text-primary" : "text-muted hover:bg-raised"}`}><LayoutDashboard size={13} />流程图</button>
      <button type="button" role="tab" aria-selected={view === "data"} onClick={() => setView("data")} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${view === "data" ? "bg-primary/15 text-primary" : "text-muted hover:bg-raised"}`}><ListTree size={13} />执行详情</button>
      <span className="ml-auto text-[10px] text-muted">{events.length} 个事件</span>
    </nav>
    {view === "data" ? <RunDetails run={run} events={events} workflow={workflow} selectedEvent={chosenEvent} loading={loading} onSelectEvent={(event) => {
      setEventId(event.id ?? null); setSelection(event.node_id ? { nodeId: event.node_id, scope: event.scope } : null);
    }} /> : <div className={`run-canvas-layout grid min-h-0 flex-1 gap-3 p-3 ${selection ? "has-inspector" : ""}`}>
      {workflow ? <RunCanvas workflow={workflow} run={run} events={events} selection={selection} onSelectNode={(nodeId, scope) => setSelection({ nodeId, scope })} /> : <div role={documentError ? "alert" : "status"} className="grid place-items-center rounded-xl border border-border/60 p-6 text-center text-xs text-muted">{documentError || <span className="flex items-center gap-2"><LoaderCircle size={14} className="animate-spin" />正在加载运行时的流程图…</span>}</div>}
      {selection && <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border/60"><div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2 text-xs"><span className="truncate">{name || selection.nodeId}</span><button type="button" aria-label="关闭节点运行数据" onClick={() => setSelection(null)} className="rounded p-1 text-muted hover:bg-raised"><X size={14} /></button></div><EventInspector run={run} event={inspectNode} name={name} /></div>}
    </div>}
  </div>;
}
