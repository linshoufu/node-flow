import { useCallback, useEffect, useMemo, useState } from "react";
import { Braces, ChevronDown, CircleAlert, CircleCheck, Clipboard, Clock3, Play, RefreshCw, X } from "lucide-react";
import { apiClient } from "@/api/client";
import { useWorkflowStore } from "@/store/workflow";
import type { RunEvent, RunRecord, RunStatus } from "@/types";
import { toast } from "./Toaster";

const STATUS: Record<RunStatus, { label: string; tone: string; icon: typeof CircleCheck }> = {
  queued: { label: "队列中", tone: "text-warning bg-warning/10", icon: Clock3 },
  running: { label: "运行中", tone: "text-primary bg-primary/10", icon: RefreshCw },
  succeeded: { label: "成功", tone: "text-success bg-success/10", icon: CircleCheck },
  failed: { label: "失败", tone: "text-danger bg-danger/10", icon: CircleAlert },
  cancelled: { label: "已取消", tone: "text-muted bg-raised", icon: X },
};

export function RunPanel() {
  const workflowId = useWorkflowStore((state) => state.workflow.id);
  const selectNode = useWorkflowStore((state) => state.selectNode);
  const [expanded, setExpanded] = useState(true);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [activeRun, setActiveRun] = useState<RunRecord | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<RunEvent | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const loadRuns = useCallback(async () => {
    if (!workflowId) { setRuns([]); setActiveRun(null); return; }
    try {
      const result = await apiClient.listWorkflowRuns(workflowId, 20);
      setRuns(result);
      setActiveRun((current) => current ? result.find((run) => run.id === current.id) ?? result[0] ?? null : result[0] ?? null);
    } catch { toast("无法加载运行记录", "error"); }
  }, [workflowId]);

  const loadEvents = useCallback(async (run: RunRecord | null) => {
    if (!run) { setEvents([]); setSelectedEvent(null); return; }
    setLoadingEvents(true);
    try {
      const result = await apiClient.getRunEvents(run.id);
      setEvents(result);
      setSelectedEvent((current) => current ? result.find((event) => event.id === current.id) ?? result.at(-1) ?? null : result.at(-1) ?? null);
    } catch { setEvents([]); setSelectedEvent(null); }
    finally { setLoadingEvents(false); }
  }, []);

  useEffect(() => { void loadRuns(); }, [loadRuns]);
  useEffect(() => { void loadEvents(activeRun); }, [activeRun, loadEvents]);
  useEffect(() => {
    const focusNewRun = (event: Event) => {
      const run = (event as CustomEvent<RunRecord>).detail;
      if (!run || run.workflow_id !== workflowId) return;
      setExpanded(true);
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setActiveRun(run);
      window.setTimeout(() => { void loadRuns(); }, 350);
    };
    window.addEventListener("nodeflow:run-created", focusNewRun);
    return () => window.removeEventListener("nodeflow:run-created", focusNewRun);
  }, [loadRuns, workflowId]);
  useEffect(() => {
    if (!activeRun || !["queued", "running"].includes(activeRun.status)) return;
    const timer = window.setInterval(() => { void loadRuns(); void loadEvents(activeRun); }, 1800);
    return () => window.clearInterval(timer);
  }, [activeRun, loadEvents, loadRuns]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("nodeflow:run-state", {
      detail: {
        run: activeRun,
        events: activeRun ? events.filter((event) => event.run_id === activeRun.id) : [],
      },
    }));
  }, [activeRun, events]);

  const createRun = async () => {
    if (!workflowId) { toast("请先创建或选择一个工作流", "error"); return; }
    try { const run = await apiClient.createRun(workflowId); setExpanded(true); setActiveRun(run); window.dispatchEvent(new CustomEvent<RunRecord>("nodeflow:run-created", { detail: run })); await loadRuns(); toast("已开始运行", "success"); }
    catch { toast("无法创建运行", "error"); }
  };

  return <section className="flex h-full min-h-0 flex-col bg-surface" aria-label="运行结果">
    <header className="flex h-10 items-center gap-2 border-b border-border/70 px-4">
      <button onClick={() => setExpanded((value) => !value)} className="flex items-center gap-2 text-xs font-semibold text-text hover:text-white" aria-expanded={expanded}>
        <ChevronDown size={15} className={`transition-transform ${expanded ? "" : "-rotate-90"}`} />运行结果
        {runs.length > 0 && <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] font-medium text-muted">{runs.length}</span>}
      </button>
      {activeRun && <StatusBadge status={activeRun.status} />}
      <div className="flex-1" />
      <button onClick={() => void loadRuns()} className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-raised hover:text-text" title="刷新运行记录" aria-label="刷新运行记录"><RefreshCw size={14} /></button>
      <button onClick={() => void createRun()} className="inline-flex h-7 items-center gap-1.5 rounded bg-primary px-2.5 text-[11px] font-semibold text-white hover:bg-primary/90"><Play size={12} fill="currentColor" />运行</button>
    </header>
    {expanded && <div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)] overflow-hidden">
      <aside className="overflow-y-auto border-r border-border/70 bg-canvas/35" aria-label="运行历史">
        {runs.length === 0 ? <EmptyState text="尚无运行记录" /> : runs.map((run) => <button key={run.id} onClick={() => setActiveRun(run)} className={`w-full border-b border-border/45 px-4 py-3 text-left transition ${activeRun?.id === run.id ? "bg-primary/10" : "hover:bg-raised/60"}`}>
          <div className="flex items-center gap-2"><StatusDot status={run.status} /><span className="min-w-0 flex-1 truncate text-xs font-medium">{run.execution_mode ?? "manual"}</span><span className="font-mono text-[10px] text-muted">#{run.id.slice(0, 6)}</span></div>
          <div className="mt-1.5 pl-4 text-[10px] text-muted">{formatTime(run.created_at)}</div>
        </button>)}
      </aside>
      <div className="min-h-0 min-w-0 overflow-y-auto bg-surface">
        {!activeRun ? <EmptyState text="选择一次运行来查看执行详情" /> : <ExecutionDetail run={activeRun} events={events} selectedEvent={selectedEvent} onSelectEvent={(event) => { setSelectedEvent(event); if (event.node_id) selectNode(event.node_id); }} loading={loadingEvents} />}
      </div>
    </div>}
  </section>;
}

function ExecutionDetail({ run, events, selectedEvent, onSelectEvent, loading }: { run: RunRecord; events: RunEvent[]; selectedEvent: RunEvent | null; onSelectEvent: (event: RunEvent) => void; loading: boolean }) {
  const duration = durationText(run.started_at, run.completed_at);
  return <div className="flex h-full min-h-0 flex-col p-4">
    <div className="mb-4 flex items-start gap-3 border-b border-border/60 pb-3"><StatusDot status={run.status} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">执行 #{run.id.slice(0, 8)}</h3><StatusBadge status={run.status} /></div><p className="mt-1 text-[11px] text-muted">{formatTime(run.created_at)} · {run.execution_mode ?? "manual"}{duration && ` · 用时 ${duration}`}</p></div>{run.error && <span className="max-w-[38%] truncate text-[11px] text-danger" title={run.error}>{run.error}</span>}</div>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,1fr)_minmax(270px,1.15fr)] overflow-hidden rounded-md border border-border/70">
      <div className="min-w-0 overflow-y-auto border-r border-border/70 p-2"><div className="mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">执行时间线</div>{loading ? <EmptyState text="正在加载事件…" /> : events.length === 0 ? <EmptyState text="该运行尚未产生事件" /> : <ol className="space-y-0.5">{events.map((event, index) => <EventRow key={event.id ?? index} event={event} selected={selectedEvent?.id === event.id} onClick={() => onSelectEvent(event)} />)}</ol>}</div>
      <EventInspector run={run} event={selectedEvent} />
    </div>
  </div>;
}

function EventRow({ event, selected, onClick }: { event: RunEvent; selected: boolean; onClick: () => void }) {
  const failed = event.type?.includes("failed") || event.type?.includes("error");
  const succeeded = event.type?.includes("succeeded");
  const label = EVENT_LABELS[event.type ?? ""] ?? event.type ?? "事件";
  return <li><button onClick={onClick} className={`flex w-full gap-3 rounded px-2 py-2 text-left transition ${selected ? "bg-primary/10 ring-1 ring-primary/20" : "hover:bg-raised/50"}`}><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${failed ? "bg-danger" : succeeded ? "bg-success" : "bg-muted"}`} /><time className="w-16 shrink-0 font-mono text-[10px] text-muted">{event.timestamp?.slice(11, 19) ?? "—"}</time><div className="min-w-0 flex-1"><div className={`text-xs ${failed ? "text-danger" : succeeded ? "text-text" : "text-text-secondary"}`}>{label}</div>{event.node_id && <div className="mt-0.5 truncate font-mono text-[10px] text-muted">节点 · {event.node_id}</div>}</div></button></li>;
}

type InspectorTab = "output" | "input" | "logs" | "raw";

function EventInspector({ run, event }: { run: RunRecord; event: RunEvent | null }) {
  const [copied, setCopied] = useState(false);
  const payload = event?.payload ?? {};
  const outputs = payload.outputs;
  const inputs = payload.inputs;
  const logs = payload.logs;
  const rawData = useMemo(() => event ? { event: { id: event.id, type: event.type, timestamp: event.timestamp, node_id: event.node_id ?? null, scope: event.scope }, payload: event.payload } : { run: { id: run.id, workflow_version: run.workflow_version, status: run.status, error: run.error, started_at: run.started_at, completed_at: run.completed_at } }, [event, run]);
  const preferredTab: InspectorTab = outputs !== undefined ? "output" : inputs !== undefined ? "input" : logs !== undefined ? "logs" : "raw";
  const [tab, setTab] = useState<InspectorTab>(preferredTab);

  useEffect(() => { setTab(preferredTab); }, [event?.id, event?.timestamp, preferredTab]);

  const activeValue = tab === "output" ? outputs : tab === "input" ? inputs : tab === "logs" ? logs : rawData;
  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(activeValue, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  const tabs: Array<{ id: InspectorTab; label: string; available: boolean }> = [
    { id: "output", label: "输出", available: outputs !== undefined },
    { id: "input", label: "输入", available: inputs !== undefined },
    { id: "logs", label: "日志", available: logs !== undefined },
    { id: "raw", label: "原始事件", available: true },
  ];

  return <aside className="flex min-h-0 min-w-0 flex-col bg-canvas/30">
    <div className="border-b border-border/70 px-3 py-2.5">
      <div className="flex items-center gap-2"><Braces size={14} className="text-primary" /><span className="min-w-0 flex-1 truncate text-[11px] font-semibold">{event ? `${EVENT_LABELS[event.type] ?? event.type}${event.node_id ? ` · ${event.node_id}` : ""}` : "运行元数据"}</span><button onClick={() => void copy()} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted hover:bg-raised hover:text-text" title="复制当前视图 JSON"><Clipboard size={12} />{copied ? "已复制" : "复制"}</button></div>
      {event && <p className="mt-1 truncate pl-[22px] font-mono text-[10px] text-muted">{formatTime(event.timestamp)} · {event.scope.length ? event.scope.join(" / ") : "主流程"}</p>}
    </div>
    <div className="flex gap-1 border-b border-border/70 px-2 py-1.5" role="tablist" aria-label="事件数据视图">{tabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} disabled={!item.available} onClick={() => setTab(item.id)} className={`rounded px-2 py-1 text-[10px] transition ${tab === item.id ? "bg-primary/15 text-primary" : "text-muted hover:bg-raised hover:text-text"} disabled:cursor-not-allowed disabled:opacity-35`}>{item.label}</button>)}</div>
    <div className="event-inspector-scroll min-h-0 flex-1 overflow-y-scroll overscroll-contain p-3">
      {tab === "output" && <OutputView value={outputs} />}
      {tab === "input" && <DataView emptyText="该事件没有记录输入数据。" value={inputs} />}
      {tab === "logs" && <DataView emptyText="该节点没有写入日志。" value={logs} />}
      {tab === "raw" && <JsonBlock label="原始事件" value={rawData} />}
    </div>
  </aside>;
}

function OutputView({ value }: { value: unknown }) {
  const outputs = record(value);
  const response = httpResponse(outputs?.success);
  if (!outputs) return <DataView emptyText="该事件没有输出数据。" value={value} />;
  if (!response) return <DataView emptyText="该事件没有输出数据。" value={outputs} />;
  const otherOutputs = Object.fromEntries(Object.entries(outputs).filter(([key]) => key !== "success"));
  const contentType = headerValue(response.headers, "content-type");
  const contentLength = headerValue(response.headers, "content-length");
  const successful = response.statusCode >= 200 && response.statusCode < 400;
  return <div className="space-y-3">
    <section className="rounded-md border border-border/70 bg-surface px-3 py-2.5"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${successful ? "bg-success" : "bg-danger"}`} /><span className="text-xs font-semibold">HTTP 响应</span><span className={`ml-auto rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${successful ? "bg-success/12 text-success" : "bg-danger/12 text-danger"}`}>{response.statusCode}</span></div><dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]"><Info label="Content-Type" value={contentType ?? "—"} /><Info label="响应大小" value={contentLength ? formatBytes(contentLength) : "未知"} /></dl></section>
    <JsonBlock label="响应体" value={response.body} />
    <details className="rounded-md border border-border/70 bg-surface"><summary className="cursor-pointer px-3 py-2 text-[11px] text-text-secondary hover:text-text">响应头 · {Object.keys(response.headers).length} 项</summary><div className="border-t border-border/60 p-3"><HeaderList headers={response.headers} /></div></details>
    {Object.keys(otherOutputs).length > 0 && <DataView emptyText="" value={otherOutputs} />}
  </div>;
}

function DataView({ emptyText, value }: { emptyText: string; value: unknown }) {
  if (value === undefined || value === null) return <EmptyState text={emptyText} />;
  const values = record(value);
  if (!values) return <JsonBlock label="数据" value={value} />;
  const entries = Object.entries(values);
  if (entries.length === 0) return <EmptyState text={emptyText} />;
  return <div className="space-y-3">{entries.map(([key, item]) => <JsonBlock key={key} label={key} value={item} />)}</div>;
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const json = JSON.stringify(value, null, 2) ?? "null";
  return <section className="overflow-hidden rounded-md border border-border/70 bg-surface"><div className="flex items-center gap-2 border-b border-border/60 px-3 py-2"><span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-text-secondary">{label}</span><span className="font-mono text-[10px] text-muted">{Array.isArray(value) ? `${value.length} 项` : typeof value}</span></div><pre className="event-json-scroll max-h-[360px] overflow-y-scroll overscroll-contain p-3 font-mono text-[10px] leading-relaxed text-text-secondary">{json}</pre></section>;
}

function HeaderList({ headers }: { headers: Record<string, unknown> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) return <p className="text-[11px] text-muted">没有响应头。</p>;
  return <dl className="space-y-1.5">{entries.map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 text-[10px]"><dt className="truncate font-mono text-muted" title={key}>{key}</dt><dd className="truncate font-mono text-text-secondary" title={String(value)}>{String(value)}</dd></div>)}</dl>;
}

function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-muted">{label}</dt><dd className="mt-0.5 truncate font-mono text-text-secondary" title={value}>{value}</dd></div>; }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function headerValue(headers: Record<string, unknown>, name: string) { const item = Object.entries(headers).find(([key]) => key.toLowerCase() === name); return item ? String(item[1]) : undefined; }
function httpResponse(value: unknown) { const item = record(value); if (!item || typeof item.status_code !== "number" || !record(item.headers)) return null; return { statusCode: item.status_code, headers: record(item.headers)!, body: item.body }; }
function formatBytes(value: string) { const bytes = Number(value); return Number.isFinite(bytes) ? bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB` : value; }

function StatusBadge({ status }: { status: RunStatus }) { const meta = STATUS[status]; const Icon = meta.icon; return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.tone}`}><Icon size={11} className={status === "running" ? "animate-spin" : ""} />{meta.label}</span>; }
function StatusDot({ status }: { status: RunStatus }) { const meta = STATUS[status]; return <span className={`h-2 w-2 shrink-0 rounded-full ${status === "succeeded" ? "bg-success" : status === "failed" ? "bg-danger" : status === "running" ? "bg-primary animate-pulse" : status === "queued" ? "bg-warning" : "bg-muted"}`} title={meta.label} />; }
function EmptyState({ text }: { text: string }) { return <div className="grid min-h-[128px] place-items-center px-4 text-center text-xs text-muted">{text}</div>; }
function formatTime(value: string | null | undefined) { return value ? value.replace("T", " ").slice(0, 19) : "—"; }
function durationText(started: string | null, completed: string | null) { if (!started || !completed) return null; const milliseconds = new Date(completed).getTime() - new Date(started).getTime(); return milliseconds < 1000 ? `${milliseconds}ms` : `${(milliseconds / 1000).toFixed(1)}s`; }

const EVENT_LABELS: Record<string, string> = { run_started: "运行开始", run_succeeded: "运行成功", run_failed: "运行失败", run_cancelled: "运行已取消", node_started: "节点开始", node_succeeded: "节点完成", node_failed: "节点失败", node_skipped: "节点跳过", node_error_handled: "节点错误已处理" };
