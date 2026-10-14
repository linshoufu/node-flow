import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Braces, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Clipboard, Clock3, ListChecks, RefreshCw, X } from "lucide-react";
import { useWorkflowStore } from "@/store/workflow";
import type { RunEvent, RunRecord, RunStatus, WorkflowDocument, WorkflowNode } from "@/types";
import { nodeName } from "@/lib/nodePresentation";
import { collectRunReport, parseBody, record, type RunReport, type RunResult } from "@/lib/runPresentation";
import { toast } from "./Toaster";

const STATUS: Record<RunStatus, { label: string; tone: string; icon: typeof CircleCheck }> = {
  queued: { label: "队列中", tone: "text-warning bg-warning/10", icon: Clock3 },
  running: { label: "运行中", tone: "text-primary bg-primary/10", icon: RefreshCw },
  succeeded: { label: "已完成", tone: "text-success bg-success/10", icon: CircleCheck },
  failed: { label: "失败", tone: "text-danger bg-danger/10", icon: CircleAlert },
  cancelled: { label: "已取消", tone: "text-muted bg-raised", icon: X },
};

export function RunDetails({ run, events, workflow, selectedEvent, onSelectEvent, loading }: { run: RunRecord; events: RunEvent[]; workflow: WorkflowDocument | null; selectedEvent: RunEvent | null; onSelectEvent: (event: RunEvent) => void; loading: boolean }) {
  const catalog = useWorkflowStore((state) => state.nodeTypes);
  const nodeInfo = useMemo(() => {
    const names: Record<string, string> = {};
    const types: Record<string, string> = {};
    const visit = (nodes: WorkflowNode[]) => nodes.forEach((node) => {
      const type = catalog.find((item) => item.id === node.type);
      names[node.id] = node.label || (type ? nodeName(type) : node.type);
      types[node.id] = node.type;
      Object.values(node.subflows ?? {}).forEach((flow) => visit(flow.nodes));
    });
    visit(workflow?.nodes ?? []);
    return { names, types };
  }, [workflow, catalog]);
  const report = useMemo(() => collectRunReport(events, nodeInfo.types), [events, nodeInfo]);
  const [view, setView] = useState<"results" | "events" | null>(null);
  const activeView = view ?? (report ? "results" : "events");
  const duration = durationText(run.started_at, run.completed_at);
  return <div className="flex h-full min-h-0 flex-col px-4 py-3">
    <div className="mb-2 flex items-center gap-3"><div className="min-w-0 flex-1"><h3 className="text-xs font-semibold">{modeName(run.execution_mode)} <span className="ml-1 font-mono font-normal text-muted">#{shortId(run.id)}</span></h3><p className="mt-1 text-[10px] text-muted">{formatTime(run.created_at)}{duration && ` · 用时 ${duration}`}</p></div>{run.error && <span className="max-w-[45%] truncate text-[11px] text-danger" title={run.error}>{run.error}</span>}{report && <div className="flex gap-1 rounded-lg bg-canvas p-1" role="tablist" aria-label="运行详情视图">{([['results', '逐条结果'], ['events', '执行事件']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={activeView === id} onClick={() => setView(id)} className={`rounded-md px-2.5 py-1 text-[11px] ${activeView === id ? 'bg-raised text-text' : 'text-muted hover:text-text'}`}>{label}</button>)}</div>}</div>
    {report && activeView === "results" ? <ResultsView report={report} run={run} names={nodeInfo.names} /> : <div className="result-detail-grid grid min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70">
      <div className="execution-timeline min-w-0 overflow-y-auto border-r border-border/70 p-2"><div className="mb-1 px-2 py-1 text-[10px] font-semibold text-muted">执行时间线 · {events.length} 个事件</div>{loading && !events.length ? <EmptyState text="正在加载事件…" /> : events.length === 0 ? <EmptyState text="该运行尚未产生事件" /> : <ol className="space-y-0.5">{events.map((event, index) => <EventRow key={event.id ?? index} event={event} name={nodeInfo.names[event.node_id ?? ""]} selected={selectedEvent?.id === event.id} onClick={() => onSelectEvent(event)} />)}</ol>}</div>
      <EventInspector run={run} event={selectedEvent} name={nodeInfo.names[selectedEvent?.node_id ?? ""]} />
    </div>}
  </div>;
}

function ResultsView({ report, run, names }: { report: RunReport; run: RunRecord; names: Record<string, string> }) {
  const [filter, setFilter] = useState<"all" | "passed" | "failed">("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const rows = report.results.map((result, ordinal) => ({ result, ordinal })).filter(({ result }) => filter === "all" || result.status === filter);
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const currentPage = Math.min(page, pages - 1);
  const selectedResult = selected === null ? null : report.results[selected] ?? null;
  const rate = report.total ? Math.round(report.passed / report.total * 100) : null;
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="result-metrics mb-2 grid shrink-0 grid-cols-4 gap-2" aria-label="结果统计">
      <Metric label={report.complete ? "总条数" : "已记录"} value={report.total} />
      <Metric label="成功" value={report.passed} tone="text-success" />
      <Metric label="失败" value={report.failed} tone={report.failed ? "text-danger" : "text-muted"} />
      <Metric label="成功率" value={rate === null ? "—" : `${rate}%`} />
    </div>
    {selectedResult ? <ResultDetail result={selectedResult} ordinal={selected!} run={run} names={names} onBack={() => setSelected(null)} /> : <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70">
      <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-3 py-1.5"><ListChecks size={14} className="shrink-0 text-primary" /><span className="result-table-hint text-[11px] text-muted">点击一条结果查看输入与响应</span><div className="ml-auto flex shrink-0 gap-1" role="group" aria-label="筛选结果">{([['all', '全部'], ['passed', '成功'], ['failed', '失败']] as const).map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => { setFilter(id); setPage(0); }} className={`rounded px-2 py-1 text-[11px] ${filter === id ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-raised'}`}>{label}</button>)}</div></div>
      <div className="min-h-0 flex-1 overflow-auto"><table className="w-full text-left text-[11px]" aria-label="逐条运行结果"><thead className="sticky top-0 z-10 bg-surface text-[10px] text-muted"><tr>{['条目', '来源 / 名称', '结果', 'HTTP', '说明'].map((label) => <th key={label} className="whitespace-nowrap border-b border-border/60 px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody>{rows.slice(currentPage * 25, (currentPage + 1) * 25).map(({ result, ordinal }) => <ResultRow key={ordinal} result={result} ordinal={ordinal} onClick={() => setSelected(ordinal)} />)}</tbody></table>{!rows.length && <EmptyState text={filter === "all" ? "尚未记录结果" : `没有${filter === "failed" ? "失败" : "成功"}的结果`} />}</div>
      {pages > 1 && <div className="flex shrink-0 items-center gap-2 border-t border-border/60 px-3 py-1 text-[10px] text-muted"><span>共 {rows.length} 条 · 第 {currentPage + 1} / {pages} 页</span><div className="flex-1" /><button className="island-button" disabled={currentPage === 0} aria-label="上一页结果" onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14} /></button><button className="island-button" disabled={currentPage + 1 === pages} aria-label="下一页结果" onClick={() => setPage(currentPage + 1)}><ChevronRight size={14} /></button></div>}
    </div>}
  </div>;
}
function Metric({ label, value, tone = "text-text" }: { label: string; value: string | number; tone?: string }) {
  return <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-canvas/40 px-3 py-2"><span className="text-[11px] text-muted">{label}</span><strong className={`font-mono text-lg leading-none ${tone}`}>{value}</strong></div>;
}
function ResultRow({ result, ordinal, onClick }: { result: RunResult; ordinal: number; onClick: () => void }) {
  const reference = result.row?.reference ?? result.row?.id;
  return <tr onClick={onClick} className="cursor-pointer border-b border-border/40 hover:bg-raised/70">
    <td className="whitespace-nowrap px-3 py-2"><button onClick={(event) => { event.stopPropagation(); onClick(); }} className="rounded text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-primary" aria-label={`查看第 ${ordinal + 1} 条结果`}>{result.index === null ? ordinal + 1 : result.index + 1}</button></td>
    <td className="max-w-[180px] px-3 py-2"><div className="truncate font-medium" title={String(reference ?? result.name)}>{String(reference ?? result.name)}</div>{reference !== undefined && <div className="mt-0.5 truncate text-[10px] text-muted">{result.name}</div>}</td>
    <td className="whitespace-nowrap px-3 py-2"><span className={`inline-flex items-center gap-1 ${result.status === "passed" ? "text-success" : "text-danger"}`}>{result.status === "passed" ? <CircleCheck size={12} /> : <CircleAlert size={12} />}{result.status === "passed" ? "成功" : "失败"}</span></td>
    <td className="px-3 py-2 font-mono text-text-secondary">{result.statusCode ?? "—"}</td>
    <td className="min-w-[160px] max-w-[400px] px-3 py-2 text-text-secondary"><p className="truncate" title={result.message}>{result.message}</p></td>
  </tr>;
}
function ResultDetail({ result, ordinal, run, names, onBack }: { result: RunResult; ordinal: number; run: RunRecord; names: Record<string, string>; onBack: () => void }) {
  const event = result.responseEvent ?? result.event;
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70">
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2"><button onClick={onBack} className="inline-flex items-center gap-1 text-[11px] text-primary"><ArrowLeft size={13} />返回列表</button><span className="text-[11px]">第 {result.index === null ? ordinal + 1 : result.index + 1} 条 · {result.name}</span><span className={`ml-auto truncate text-[11px] ${result.status === "failed" ? 'text-danger' : 'text-success'}`} title={result.message}>{result.message}</span></div>
    <div className="result-row-detail grid min-h-0 flex-1 grid-cols-[minmax(160px,.65fr)_minmax(250px,1fr)]"><div className="min-w-0 overflow-y-auto border-r border-border/60 p-3"><JsonBlock label="来源数据" value={result.row ?? {}} /><details className="mt-2 text-[11px] text-muted"><summary className="cursor-pointer py-1">完整结果</summary><JsonBlock label="记录" value={result.raw} /></details></div>{event ? <EventInspector run={run} event={event} name={names[event.node_id ?? ""]} /> : <div className="overflow-y-auto p-3"><JsonBlock label="实际结果" value={result.raw.actual ?? result.raw} /></div>}</div>
  </div>;
}

function EventRow({ event, name, selected, onClick }: { event: RunEvent; name?: string; selected: boolean; onClick: () => void }) {
  const failed = event.type?.includes("failed") || event.type?.includes("error");
  const succeeded = event.type?.includes("succeeded");
  const label = EVENT_LABELS[event.type ?? ""] ?? event.type ?? "事件";
  return <li><button onClick={onClick} className={`flex w-full gap-2 rounded px-2 py-2 text-left transition ${selected ? "bg-primary/10 ring-1 ring-primary/20" : "hover:bg-raised/50"}`}><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${failed ? "bg-danger" : succeeded ? "bg-success" : "bg-muted"}`} /><time className="w-14 shrink-0 font-mono text-[10px] text-muted">{clockTime(event.timestamp)}</time><div className="min-w-0 flex-1"><div className={`text-xs ${failed ? "text-danger" : succeeded ? "text-text" : "text-text-secondary"}`}>{label}</div>{event.node_id && <div className="mt-0.5 truncate text-[10px] text-muted" title={event.node_id}>{name ?? event.node_id}</div>}</div></button></li>;
}

type InspectorTab = "output" | "input" | "logs" | "raw";

export function EventInspector({ run, event, name }: { run: RunRecord; event: RunEvent | null; name?: string }) {
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
    try {
      await navigator.clipboard.writeText(JSON.stringify(activeValue, null, 2) ?? "null");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { toast("无法复制到剪贴板", "error"); }
  };
  const tabs: Array<{ id: InspectorTab; label: string; available: boolean }> = [
    { id: "output", label: "输出", available: outputs !== undefined },
    { id: "input", label: "输入", available: inputs !== undefined },
    { id: "logs", label: "日志", available: logs !== undefined },
    { id: "raw", label: "原始事件", available: true },
  ];

  return <aside className="flex min-h-0 min-w-0 flex-col bg-canvas/30">
    <div className="border-b border-border/70 px-3 py-2.5">
      <div className="flex items-center gap-2"><Braces size={14} className="text-primary" /><span className="min-w-0 flex-1 truncate text-[11px] font-semibold">{event ? `${EVENT_LABELS[event.type] ?? event.type}${event.node_id ? ` · ${name ?? event.node_id}` : ""}` : "运行元数据"}</span><button onClick={() => void copy()} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted hover:bg-raised hover:text-text" title="复制当前视图 JSON"><Clipboard size={12} />{copied ? "已复制" : "复制"}</button></div>
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
  const port = httpResponse(outputs?.success) ? "success" : "error";
  const response = httpResponse(outputs?.[port]);
  if (!outputs) return <DataView emptyText="该事件没有输出数据。" value={value} />;
  if (!response) return <DataView emptyText="该事件没有输出数据。" value={outputs} />;
  const otherOutputs = Object.fromEntries(Object.entries(outputs).filter(([key]) => key !== port));
  const contentType = headerValue(response.headers, "content-type");
  const contentLength = headerValue(response.headers, "content-length");
  const successful = response.statusCode >= 200 && response.statusCode < 400;
  return <div className="space-y-3">
    <section className="rounded-md border border-border/70 bg-surface px-3 py-2.5"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${successful ? "bg-success" : "bg-danger"}`} /><span className="text-xs font-semibold">HTTP 响应</span><span className={`ml-auto rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${successful ? "bg-success/12 text-success" : "bg-danger/12 text-danger"}`}>{response.statusCode}</span></div><dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]"><Info label="内容类型" value={contentType ?? "—"} /><Info label="响应大小" value={contentLength ? formatBytes(contentLength) : "未知"} /></dl></section>
    <JsonBlock label="响应体" value={response.body} />
    {Object.keys(response.headers).length > 0 && <details className="rounded-md border border-border/70 bg-surface"><summary className="cursor-pointer px-3 py-2 text-[11px] text-text-secondary hover:text-text">响应头 · {Object.keys(response.headers).length} 项</summary><div className="border-t border-border/60 p-3"><HeaderList headers={response.headers} /></div></details>}
    {Object.keys(otherOutputs).length > 0 && <DataView emptyText="" value={otherOutputs} />}
  </div>;
}

function DataView({ emptyText, value }: { emptyText: string; value: unknown }) {
  if (value === undefined || value === null) return <EmptyState text={emptyText} />;
  const values = record(value);
  if (!values) return <JsonBlock label="数据" value={value} />;
  const entries = Object.entries(values);
  if (entries.length === 0) return <EmptyState text={emptyText} />;
  return <div className="space-y-3">{entries.map(([key, item]) => <JsonBlock key={key} label={({ success: "正常输出", error: "错误输出", passed: "断言通过", failed: "断言失败", done: "循环完成" } as Record<string, string>)[key] ?? key} value={item} />)}</div>;
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const json = JSON.stringify(value, null, 2) ?? "null";
  return <section className="overflow-hidden rounded-md border border-border/70 bg-surface"><div className="flex items-center gap-2 border-b border-border/60 px-3 py-2"><span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-text-secondary">{label}</span><span className="text-[10px] text-muted">{Array.isArray(value) ? `${value.length} 项` : ({ object: "对象", string: "文本", number: "数值", boolean: "布尔值" } as Record<string, string>)[typeof value] ?? "数据"}</span></div><pre className="event-json-scroll max-h-[360px] overflow-auto overscroll-contain p-3 font-mono text-[11px] leading-relaxed text-text-secondary">{json}</pre></section>;
}

function HeaderList({ headers }: { headers: Record<string, unknown> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) return <p className="text-[11px] text-muted">没有响应头。</p>;
  return <dl className="space-y-1.5">{entries.map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 text-[10px]"><dt className="truncate font-mono text-muted" title={key}>{key}</dt><dd className="truncate font-mono text-text-secondary" title={String(value)}>{String(value)}</dd></div>)}</dl>;
}

function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-muted">{label}</dt><dd className="mt-0.5 truncate font-mono text-text-secondary" title={value}>{value}</dd></div>; }
function headerValue(headers: Record<string, unknown>, name: string) { const item = Object.entries(headers).find(([key]) => key.toLowerCase() === name); return item ? String(item[1]) : undefined; }
function httpResponse(value: unknown) { const item = record(value); if (!item || typeof item.status_code !== "number") return null; return { statusCode: item.status_code, headers: record(item.headers) ?? {}, body: parseBody(item.body) }; }
function formatBytes(value: string) { const bytes = Number(value); return Number.isFinite(bytes) ? bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB` : value; }

export function StatusBadge({ status }: { status: RunStatus }) { const meta = STATUS[status]; const Icon = meta.icon; return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.tone}`}><Icon size={11} className={status === "running" ? "animate-spin" : ""} />{meta.label}</span>; }
export function StatusDot({ status }: { status: RunStatus }) { const meta = STATUS[status]; return <span className={`h-2 w-2 shrink-0 rounded-full ${status === "succeeded" ? "bg-success" : status === "failed" ? "bg-danger" : status === "running" ? "bg-primary animate-pulse" : status === "queued" ? "bg-warning" : "bg-muted"}`} title={meta.label} />; }
function EmptyState({ text }: { text: string }) { return <div className="grid min-h-[128px] place-items-center px-4 text-center text-xs text-muted">{text}</div>; }
export function formatTime(value: string | null | undefined) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date); }
function clockTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date); }
export function modeName(mode: RunRecord["execution_mode"]) { return ({ manual: "手动运行", schedule: "定时运行", webhook: "Webhook 触发", webhook_test: "Webhook 调试", child: "子流程运行", error: "错误处理" })[mode ?? "manual"]; }
export function shortId(id: string) { return id.replace(/^run_/, "").slice(0, 6); }
export function preferredEvent(events: RunEvent[]) { const latest = [...events].reverse(); return latest.find((event) => event.type === "node_failed") ?? latest.find((event) => httpResponse(record(event.payload.outputs)?.success) || httpResponse(record(event.payload.outputs)?.error)) ?? latest.find((event) => event.payload.outputs !== undefined) ?? events.at(-1) ?? null; }
function durationText(started: string | null, completed: string | null) { if (!started || !completed) return null; const milliseconds = new Date(completed).getTime() - new Date(started).getTime(); return milliseconds < 1000 ? `${milliseconds}ms` : `${(milliseconds / 1000).toFixed(1)}s`; }

const EVENT_LABELS: Record<string, string> = { run_started: "运行开始", run_succeeded: "运行成功", run_failed: "运行失败", run_cancelled: "运行已取消", node_started: "节点开始", node_succeeded: "节点完成", node_failed: "节点失败", node_skipped: "节点跳过", node_error_handled: "节点错误已处理" };
