import type { CSSProperties, ReactNode } from "react";
import { Check, Clock3, GitBranch, LoaderCircle, Puzzle, X } from "lucide-react";
import type { HttpProfile, NodeFormManifest, NodePort, NodeSummaryTemplate, NodeType, WorkflowNode } from "@/types";
import { categoryColor, categoryName, nodeIcon, nodeName } from "@/lib/nodePresentation";
import { resolveNodePorts } from "@/lib/nodeInstance";
import { NumberInput } from "./NumberInput";

export const NODE_HANDLE_CLASS = "node-handle !h-3 !w-3 !border-2 !border-surface hover:!scale-125";
type NodeCardProps = {
  node: WorkflowNode; nodeType?: NodeType; manifest?: NodeFormManifest;
  label?: string; selected?: boolean; connectedOutputHandles?: string[];
  highlightedInputHandles?: string[]; highlightedOutputHandles?: string[];
  httpProfiles?: HttpProfile[]; runStatus?: NodeRunStatus | null;
  readOnly?: boolean;
  onConfigChange?: (key: string, value: unknown) => void;
  onOpenSubflow?: (node: WorkflowNode) => void;
  renderHandle?: (direction: "input" | "output", id: string, port: NodePort, color: string) => ReactNode;
};

export function NodeCard({ node: workflowNode, nodeType, manifest, selected = false, connectedOutputHandles = [], highlightedInputHandles = [], highlightedOutputHandles = [], httpProfiles = [], runStatus = null, readOnly = false, onConfigChange, onOpenSubflow, renderHandle, label = workflowNode.label || (nodeType ? nodeName(nodeType) : workflowNode.type) }: NodeCardProps) {
  const color = manifest?.cardStyle?.accent ?? categoryColor(nodeType?.category ?? "");
  const compact = manifest?.cardStyle?.density === "compact";
  const inputs = orderedPorts("inputs", nodeType ? resolveNodePorts(nodeType, workflowNode.config, "inputs") : {}, manifest);
  const outputs = orderedPorts("outputs", nodeType ? resolveNodePorts(nodeType, workflowNode.config, "outputs") : {}, manifest);
  // Node Studio treats an unspecified placement as "panel". Keep this rule here
  // as well, otherwise the collapsed card looks right but its expanded state
  // leaks fields that were intentionally kept out of the canvas.
  const fields = nodeType?.form?.groups.flatMap((group) => group.fields).filter((field) => (manifest?.placements?.[field.key] ?? field.placement ?? "panel") === "inline") ?? [];
  const visibleFields = fields.slice(0, 3);
  const summary = manifest?.cardStyle?.summary === "hidden" ? null : nodeSummary(nodeType?.id, workflowNode, httpProfiles, manifest?.summaryTemplate);
  const visibleInputs = inputs.filter(([id, port]) => shouldShowPort("inputs", id, port, manifest, selected, connectedOutputHandles));
  const visibleOutputs = outputs.filter(([id, port]) => shouldShowPort("outputs", id, port, manifest, selected, connectedOutputHandles));
  const hasBodySubflow = Boolean(workflowNode.subflows?.body) || ["control.each_item", "control.foreach", "control.while"].includes(nodeType?.id ?? "");
  const bodyNodeCount = workflowNode.subflows?.body?.nodes.length ?? 0;
  const Icon = nodeType ? nodeIcon(nodeType) : Puzzle;

  return (
    <article data-run-status={runStatus ?? undefined} className={`node-card min-w-[250px] max-w-[310px] overflow-visible rounded-xl border bg-surface ${selected ? "is-selected border-primary" : "border-border hover:border-border-hover"} ${workflowNode.disabled ? "opacity-55" : ""}`} style={{ "--node-accent": color } as CSSProperties}>
      <header className={`flex items-center gap-2.5 rounded-t-[11px] px-3 ${compact ? "min-h-11 py-1.5" : "min-h-14 py-2.5"}`}>
        <span className={`node-icon grid shrink-0 place-items-center rounded-lg ${compact ? "h-7 w-7" : "h-8 w-8"}`}><Icon size={18} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold leading-5 tracking-[.01em]" title={label}>{label}</h3>
          <div className="mt-0.5 flex items-center justify-between gap-2"><span className="text-[10px] text-muted">{nodeType ? categoryName(nodeType.category) : "节点"}</span>{runStatus && <NodeRunStatusBadge status={runStatus} />}</div>
        </div>
      </header>
      <div className={compact ? "py-1" : "py-2"}>
        {visibleInputs.map(([key, port]) => <PortRow key={`in-${key}`} id={key} port={port} direction="input" compact={compact} highlighted={highlightedInputHandles.includes(key)} renderHandle={renderHandle} />)}
        {summary && <NodeSummaryView summary={summary} compact={compact} />}
        {hasBodySubflow && <button type="button" disabled={!onOpenSubflow} className="nodrag nopan nowheel mx-3 my-2 flex w-[calc(100%_-_1.5rem)] items-center justify-between rounded-lg border border-primary/15 bg-primary/5 px-2.5 py-2 text-[11px] text-text-secondary hover:border-primary/50 hover:text-text focus:outline-none focus:ring-1 focus:ring-primary/50" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpenSubflow?.(workflowNode); }}><span className="flex items-center gap-2"><GitBranch size={14} className="text-primary" />{readOnly ? "查看循环体" : "编辑循环体"}</span><span className="text-muted">{bodyNodeCount} 个节点</span></button>}
        {visibleFields.length > 0 && <fieldset disabled={readOnly} className="mx-3 my-2 rounded-lg border border-border/50 bg-canvas/50 px-2 py-1">
        {visibleFields.map((field) => {
          const current = workflowNode.config[field.key];
          return <WidgetRow key={field.key} label={field.label ?? field.key} value={current} control={field.control} options={field.options} httpProfiles={httpProfiles} compact={compact} onChange={(value) => onConfigChange?.(field.key, value)} />;
        })}
        {fields.length > 3 && <p className="py-1 text-center text-[10px] text-muted">其余 {fields.length - 3} 项在右侧配置</p>}
        </fieldset>}
        {visibleInputs.length > 0 && visibleOutputs.length > 0 && !summary && !hasBodySubflow && !visibleFields.length && <div className="mx-3 my-1 border-t border-border/40" />}
        {visibleOutputs.map(([key, port]) => <PortRow key={`out-${key}`} id={key} port={port} direction="output" compact={compact} highlighted={highlightedOutputHandles.includes(key)} renderHandle={renderHandle} />)}
        {!visibleInputs.length && !visibleOutputs.length && !summary && <p className="px-3 py-3 text-[11px] text-muted">此节点未声明端口</p>}
      </div>
    </article>
  );
}

function portColor(port: NodePort, direction: "input" | "output") {
  if (port.category === "error") return "#fb7185";
  if (port.category === "control") return "#b498ff";
  return direction === "input" ? "#91a0b8" : "#58d3aa";
}

function PortRow({ id, port, direction, compact, highlighted, renderHandle }: { id: string; port: NodePort; direction: "input" | "output"; compact: boolean; highlighted: boolean; renderHandle?: NodeCardProps["renderHandle"] }) {
  const color = portColor(port, direction);
  const label = port.displayName ?? id;
  if (port.collapsed) return null;
  return <div data-port-direction={direction} data-port-id={id} className={`node-port relative flex items-center px-3 text-xs ${highlighted ? "is-highlighted" : ""} ${compact ? "min-h-6" : "min-h-[30px]"} ${direction === "output" ? "justify-end text-right" : "justify-start"}`} style={{ "--port-color": color } as CSSProperties}>
    {renderHandle ? renderHandle(direction, id, port, color) : <span className={`react-flow__handle react-flow__handle-${direction === "input" ? "left" : "right"} ${NODE_HANDLE_CLASS}`} style={{ background: color }} data-handleid={id} title={port.description ?? label} aria-hidden="true" />}
    <span className="node-port-label truncate text-text-secondary" title={label}>{label}{port.required && <span className="ml-1 text-danger">*</span>}</span>
  </div>;
}

function WidgetRow({ label, value, control, options, httpProfiles, compact, onChange }: { label: string; value: unknown; control: string; options?: { label: string; value: string }[]; httpProfiles: HttpProfile[]; compact: boolean; onChange: (value: unknown) => void }) {
  const base = "min-w-0 flex-1 rounded-md border border-border/70 bg-raised/80 px-2 py-1 text-xs text-text outline-none focus:border-primary focus:ring-1 focus:ring-primary/20";
  const rowHeight = compact ? "min-h-7" : "min-h-8";
  if (control === "switch") return <label className={`nodrag flex items-center justify-between gap-2 text-[11px] text-text-secondary ${rowHeight}`}><span className="min-w-0 truncate" title={label}>{label}</span><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="node-toggle shrink-0" /></label>;
  if (control === "select" && options) return <label className={`nodrag flex items-center gap-2 text-[11px] text-text-secondary ${rowHeight}`}><span className="w-[43%] truncate" title={label}>{label}</span><select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} className={base}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
  if (control === "http_profile") return <label className={`nodrag flex items-center gap-2 text-[11px] text-text-secondary ${rowHeight}`}><span className="w-[43%] truncate" title={label}>{label}</span><select aria-label={label} value={String(value ?? "")} onChange={(event) => onChange(event.target.value || null)} className={base} title={httpProfiles.find((profile) => profile.id === value)?.base_url ?? ""}><option value="">未设置</option>{httpProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>;
  if (control === "number") return <div className={`nodrag flex min-w-0 items-center gap-2 text-[11px] text-text-secondary ${rowHeight}`}><span className="w-[43%] shrink-0 truncate" title={label}>{label}</span><NumberInput compact aria-label={label} value={typeof value === "string" || typeof value === "number" ? value : ""} onValueChange={(value) => onChange(Number(value))} className="min-w-0 flex-1" /></div>;
  return <label className={`nodrag flex items-center gap-2 text-[11px] text-text-secondary ${rowHeight}`}><span className="w-[43%] truncate" title={label}>{label}</span><input type="text" value={typeof value === "string" || typeof value === "number" ? String(value) : ""} onChange={(event) => onChange(event.target.value)} className={base} /></label>;
}

function orderedPorts(direction: "inputs" | "outputs", ports: Record<string, NodePort>, manifest?: NodeFormManifest) {
  return Object.entries(ports).map(([id, port]) => [id, { ...port, ...manifest?.portPresentation?.[direction]?.[id] }] as const).sort(([leftId, left], [rightId, right]) => (left.order ?? 0) - (right.order ?? 0) || leftId.localeCompare(rightId));
}

type NodeSummary = { badge: string; primary: string; secondary?: string; warning?: boolean };
export type NodeRunStatus = "waiting" | "running" | "succeeded" | "failed" | "skipped";

const NODE_RUN_STATUS: Record<NodeRunStatus, { label: string; className: string; icon: typeof Check }> = {
  waiting: { label: "等待", className: "bg-raised text-muted", icon: Clock3 },
  running: { label: "运行中", className: "bg-primary/15 text-primary", icon: LoaderCircle },
  succeeded: { label: "成功", className: "bg-success/12 text-success", icon: Check },
  failed: { label: "失败", className: "bg-danger/12 text-danger", icon: X },
  skipped: { label: "跳过", className: "bg-raised text-muted", icon: X },
};

function NodeRunStatusBadge({ status }: { status: NodeRunStatus }) {
  const definition = NODE_RUN_STATUS[status];
  const Icon = definition.icon;
  return <span className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-3 ${definition.className}`} aria-label={`最近一次运行：${definition.label}`} title={`最近一次运行：${definition.label}`}>
    <Icon size={12} className={status === "running" ? "animate-spin" : ""} />
    {definition.label}
  </span>;
}

function NodeSummaryView({ summary, compact }: { summary: NodeSummary; compact: boolean }) {
  return <div className={`nodrag mx-3 my-2 rounded-lg bg-raised/55 px-2.5 ${compact ? "py-1.5" : "py-2"}`}>
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span className={`shrink-0 rounded px-1.5 py-0.5 font-semibold ${summary.warning ? "bg-warning/12 text-warning" : "bg-primary/12 text-primary"}`}>{summary.badge}</span>
      <span className={`min-w-0 truncate ${summary.warning ? "text-warning" : "text-text-secondary"}`} title={summary.primary}>{summary.primary}</span>
    </div>
    {summary.secondary && <p className="mt-1.5 truncate text-[11px] text-muted" title={summary.secondary}>{summary.secondary}</p>}
  </div>;
}

function shouldShowPort(direction: "inputs" | "outputs", id: string, port: NodePort, manifest: NodeFormManifest | undefined, selected: boolean, connectedOutputs: string[]) {
  const configured = manifest?.portPresentation?.[direction]?.[id]?.collapsed;
  if (configured === true || (configured === undefined && port.collapsed)) return false;
  if (configured === false) return true;
  if (direction === "outputs" && port.category === "error") return selected || connectedOutputs.includes(id);
  return true;
}

function nodeSummary(nodeTypeId: string | undefined, node: WorkflowNode, httpProfiles: HttpProfile[], template?: NodeSummaryTemplate | null): NodeSummary | null {
  const config = node.config;
  if (template?.primary?.trim()) {
    return {
      badge: renderSummaryTemplate(template.badge || "摘要", config),
      primary: renderSummaryTemplate(template.primary, config),
      secondary: template.secondary?.trim() ? renderSummaryTemplate(template.secondary, config) : undefined,
    };
  }
  if (nodeTypeId === "http.request") {
    const method = typeof config.method === "string" ? config.method.toUpperCase() : "GET";
    const profile = httpProfiles.find((candidate) => candidate.id === config.http_profile_id);
    const url = typeof config.url === "string" && config.url.trim() ? config.url.trim() : "未设置 URL";
    return { badge: method, primary: profile?.name ?? "未选择 HTTP 配置档", secondary: url, warning: !profile || url === "未设置 URL" };
  }
  if (nodeTypeId === "control.each_item") {
    const maximum = typeof config.max_items === "number" ? config.max_items : 100;
    const subflowCount = Object.values(node.subflows ?? {}).reduce((count, subflow) => count + subflow.nodes.length, 0);
    return {
      badge: "循环",
      primary: `最多 ${maximum} 项 · ${config.continue_on_error ? "失败后继续" : "遇错停止"}`,
      secondary: subflowCount > 0 ? `循环体包含 ${subflowCount} 个节点` : "循环体尚未配置",
      warning: subflowCount === 0,
    };
  }
  if (nodeTypeId === "data.group_items") {
    const paths = stringList(config.paths);
    return { badge: "分组", primary: paths.length ? `按 ${paths.join("、")} 分组` : "未设置分组字段", warning: paths.length === 0 };
  }
  if (nodeTypeId === "data.json_template") {
    const template = parsedValue(config.template);
    if (Array.isArray(template)) return { badge: "JSON", primary: `数组模板 · ${template.length} 项` };
    if (template && typeof template === "object") return { badge: "JSON", primary: `对象模板 · ${Object.keys(template).length} 个字段`, secondary: Object.keys(template).slice(0, 4).join("、") };
    return { badge: "JSON", primary: "未配置模板", warning: true };
  }
  return null;
}

function renderSummaryTemplate(template: string, config: Record<string, unknown>) {
  return template.replace(/\{\{\s*(?:config\.)?([\w.-]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split(".").reduce<unknown>((current, key) => recordValue(current)?.[key], config);
    if (value === undefined || value === null || value === "") return "未设置";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}

function parsedValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function stringList(value: unknown): string[] {
  const parsed = parsedValue(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}


function recordValue(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
