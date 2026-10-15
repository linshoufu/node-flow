import { useState, type ReactNode } from "react";
import { Link2 } from "lucide-react";
import type { ConfigBinding, JsonSchema, NodeType, WorkflowNode } from "@/types";
import { useWorkflowStore } from "@/store/workflow";
import { runParameterDeclaration } from "@/lib/runParameters";
import { Select } from "./Select";
import { DataValueEditor } from "./DataValueEditor";
import { fromDataLiteral, toDataLiteral } from "@/lib/dataExpressionPresentation";

export function bindingAllowed(nodeType: NodeType, key: string) {
  return nodeType.id !== "workflow.parameters" && ![nodeType.dynamicInputs?.configKey, nodeType.dynamicOutputs?.configKey].includes(key.split(".")[0]);
}
export function configPathValue(config: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, config);
}
export function configPathUpdate(config: Record<string, unknown>, path: string, value: unknown): [string, unknown] {
  const [root, ...rest] = path.split(".");
  if (!rest.length) return [root, value];
  const result = structuredClone(config[root] && typeof config[root] === "object" ? config[root] as Record<string, unknown> : {});
  let current = result;
  rest.forEach((part, index) => { if (index === rest.length - 1) current[part] = value; else { const child = current[part]; current[part] = child && typeof child === "object" ? child : {}; current = current[part] as Record<string, unknown>; } });
  return [root, result];
}
function valueSummary(value: unknown) {
  if (value === undefined) return "运行时提供（未设置默认值）";
  if (value === null) return "未设置";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return `列表 · ${value.length} 项`;
  if (typeof value === "object") { const object = value as Record<string, unknown>; return `${typeof object.name === "string" ? object.name + " · " : "对象 · "}${Object.keys(object).length} 个字段`; }
  return String(value);
}

/** Source selection lives beside the value it controls; stored bindings stay separate. */
export function FieldValueSource({ node, nodeType, path, label, children }: { node: WorkflowNode; nodeType: NodeType; path: string; label: string; children: ReactNode }) {
  const workflow = useWorkflowStore((state) => state.workflow);
  const setBindings = useWorkflowStore((state) => state.setNodeBindings);
  const updateConfig = useWorkflowStore((state) => state.updateNodeConfig);
  const [selecting, setSelecting] = useState(false);
  const binding = node.configBindings?.[path];
  const references = (() => {
    let parameters: NonNullable<ReturnType<typeof runParameterDeclaration>>["fields"] = [];
    try { parameters = runParameterDeclaration(workflow)?.fields ?? []; } catch { /* Invalid parameter drafts are handled by their editor. */ }
    return [...(workflow.settings?.configuration ?? []).map((field) => ({ source: "workflow" as const, field })), ...parameters.map((field) => ({ source: "parameter" as const, field }))];
  })();
  if (!bindingAllowed(nodeType, path)) return <>{children}</>;
  const selected = references.find((item) => item.source === binding?.source && item.field.name === binding?.key);
  const active = !!binding || selecting;
  const descendants = Object.keys(node.configBindings ?? {}).filter((target) => target.startsWith(`${path}.`));
  const selectValue = binding ? `${binding.source}:${binding.key}` : "";
  const fixed = () => {
    if (binding) {
      if (configPathValue(node.config, path) === undefined && selected?.field.default !== undefined) updateConfig(node.id, ...configPathUpdate(node.config, path, structuredClone(selected.field.default)));
      const next = { ...node.configBindings }; delete next[path]; setBindings(node.id, next);
    }
    setSelecting(false);
  };
  return <section className="mb-3 min-w-0 last:mb-0" aria-label={`${label}取值`}>
    <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2"><span className="truncate text-xs font-medium text-text-secondary" title={label}>{label}</span><div className="flex shrink-0 rounded-md bg-canvas/60 p-0.5" role="group" aria-label={`${label}取值方式`}><button type="button" aria-pressed={!active} onClick={fixed} className={`rounded px-1.5 py-0.5 text-[10px] ${!active ? "bg-raised text-text" : "text-muted hover:text-text"}`}>固定值</button><button type="button" aria-pressed={active} disabled={!!descendants.length} title={descendants.length ? "先将下方子字段改为固定值，再引用整个对象" : undefined} onClick={() => setSelecting(true)} className={`rounded px-1.5 py-0.5 text-[10px] ${active ? "bg-primary/15 text-primary" : "text-muted hover:text-text"}`}>引用</button></div></div>
    {active ? <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/5 p-2"><div className="flex items-center gap-1.5"><Link2 size={12} className="shrink-0 text-primary" /><Select aria-label={`${label}引用来源`} value={selectValue} onValueChange={(value) => { const [source, key] = value.split(":"); setBindings(node.id, { ...node.configBindings, [path]: { source: source as ConfigBinding["source"], key } }); setSelecting(false); }} className="min-w-0 flex-1"><option value="" disabled>选择配置或参数</option>{references.map(({ source, field }) => <option key={`${source}:${field.name}`} value={`${source}:${field.name}`}>{source === "workflow" ? "工作流配置" : "运行参数"} · {field.label || field.name}</option>)}{binding && !selected && <option value={selectValue}>引用已失效 · {binding.key}</option>}</Select></div>{binding && <p className={`truncate text-[11px] ${selected ? "text-muted" : "text-danger"}`} title={selected ? valueSummary(selected.field.default) : binding.key}>{selected ? `当前值：${valueSummary(selected.field.default)}` : "找不到此配置，请重新选择或改用固定值"}</p>}{!references.length && <p className="text-[10px] leading-relaxed text-muted">先在工作流设置或运行参数节点中添加配置。</p>}</div> : <>{children}{descendants.length > 0 && <div className="mt-2 space-y-3 rounded-lg border border-primary/20 p-2"><p className="text-[10px] text-muted">以下子字段使用引用，覆盖对应的固定值</p>{descendants.map((target) => <WorkflowBoundOption key={target} node={node} nodeType={nodeType} path={target} binding={node.configBindings?.[target]} />)}</div>}</>}
  </section>;
}

/** Expose schema configuration omitted from the main form, including old nested bindings. */
export function ExtraConfigurationFields({ node, nodeType }: { node: WorkflowNode; nodeType: NodeType }) {
  const updateConfig = useWorkflowStore((state) => state.updateNodeConfig);
  if (nodeType.id === "workflow.parameters") return null;
  const shown = new Set(nodeType.form?.groups.flatMap((group) => group.fields.map((field) => field.key)) ?? []);
  if (nodeType.profileType) shown.add("profile_id");
  const extra = Object.entries(nodeType.configSchema?.properties ?? {}).filter(([key, schema]) => (!schema.deprecated || Object.keys(node.configBindings ?? {}).some((path) => path === key || path.startsWith(`${key}.`))) && (nodeType.id === "data.compose" ? Object.keys(node.configBindings ?? {}).some((path) => path === key || path.startsWith(`${key}.`)) : !shown.has(key)));
  if (!extra.length || !nodeType.form?.groups.length) return null;
  const edit = (path: string, value: unknown) => updateConfig(node.id, ...configPathUpdate(node.config, path, value));
  const field = (path: string, label: string, schema?: JsonSchema) => <FieldValueSource key={path} node={node} nodeType={nodeType} path={path} label={label}><DataValueEditor literalOnly label={label} expression={toDataLiteral(configPathValue(node.config, path) ?? schema?.default)} onChange={(expression) => edit(path, fromDataLiteral(expression))} /></FieldValueSource>;
  return <section className="border-t border-border/60 px-4 py-3">{extra.map(([key, schema]) => {
    const paths = node.configBindings?.[key] ? [] : [...new Set([...Object.keys(node.configBindings ?? {}).filter((path) => path.startsWith(`${key}.`)), ...Object.keys(node.config[key] && typeof node.config[key] === "object" && !Array.isArray(node.config[key]) ? node.config[key] as Record<string, unknown> : {}).map((part) => `${key}.${part}`)])];
    if (paths.length && key === "options") return <div key={key}><h3 className="mb-3 text-xs font-semibold">{schema.title === "Options" || key === "options" ? "处理选项" : schema.title || key}</h3>{paths.map((path) => {
      const binding = node.configBindings?.[path];
      // The field label can follow the chosen workflow declaration without changing its stable target path.
      return <WorkflowBoundOption key={path} node={node} nodeType={nodeType} path={path} binding={binding} />;
    })}</div>;
    return <details key={key} className="mb-2"><summary className="cursor-pointer text-xs text-muted">{key === "options" ? "处理选项" : schema.title || key}</summary><div className="mt-3">{field(key, key === "options" ? "处理选项" : schema.title || key, schema)}</div></details>;
  })}</section>;
}
function WorkflowBoundOption({ node, nodeType, path, binding }: { node: WorkflowNode; nodeType: NodeType; path: string; binding?: ConfigBinding }) {
  const fields = useWorkflowStore((state) => state.workflow.settings?.configuration);
  const label = fields?.find((field) => (!binding || binding.source === "workflow") && field.name === (binding?.key ?? path.split(".").at(-1)))?.label || path.split(".").at(-1)!;
  const updateConfig = useWorkflowStore((state) => state.updateNodeConfig);
  return <FieldValueSource node={node} nodeType={nodeType} path={path} label={label}><DataValueEditor literalOnly label={label} expression={toDataLiteral(configPathValue(node.config, path))} onChange={(expression) => updateConfig(node.id, ...configPathUpdate(node.config, path, fromDataLiteral(expression)))} /></FieldValueSource>;
}
