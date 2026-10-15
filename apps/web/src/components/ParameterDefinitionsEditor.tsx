import { Select } from "./Select";
import { useEffect, useId, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { RunParameter } from "@/lib/runParameters";
import { changeParameterType, newParameter, parameterDefinitionIssue, parameterTypes } from "@/lib/parameterDefinitions";
import { NumberInput } from "./NumberInput";

const input = "h-[34px] w-full min-w-0 rounded-md border border-border bg-raised px-2 text-xs text-text outline-none focus:border-primary focus:ring-1 focus:ring-primary/25";
const action = "rounded p-1 text-muted hover:bg-raised hover:text-text disabled:opacity-30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary";

export function ParameterDefinitionsEditor({ value, onChange }: { value: unknown; onChange: (value: RunParameter[]) => void }) {
  if (value !== undefined && (!Array.isArray(value) || value.some((field) => !field || typeof field !== "object" || typeof field.name !== "string"))) {
    return <p role="alert" className="text-xs text-danger">参数定义格式无效，请先恢复有效的参数数组。</p>;
  }
  const fields = (value ?? []) as RunParameter[];
  const update = (index: number, field: RunParameter) => onChange(fields.map((item, i) => i === index ? field : item));
  const move = (index: number, offset: number) => {
    const next = [...fields];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  return <div className="space-y-3" aria-label="运行参数定义">
    <p className="text-[11px] leading-relaxed text-muted">在这里定义运行前需要填写的内容。默认值会自动带入运行表单。</p>
    {!fields.length && <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-muted">暂无参数，添加第一个参数开始配置。</p>}
    {fields.map((field, index) => <ParameterDefinitionRow key={index} field={field} index={index}
      issue={parameterDefinitionIssue(field, fields, index)}
      canMoveUp={index > 0} canMoveDown={index < fields.length - 1}
      onMove={(offset) => move(index, offset)} onChange={(next) => update(index, next)}
      onDelete={() => onChange(fields.filter((_, i) => i !== index))} />)}
    <button type="button" onClick={() => onChange([...fields, newParameter(fields)])} className="flex h-[34px] w-full items-center justify-center gap-1.5 rounded-md border border-primary/35 bg-primary/8 text-xs text-primary hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"><Plus size={13} />添加参数</button>
  </div>;
}

function ParameterDefinitionRow({ field, index, issue, canMoveUp, canMoveDown, onMove, onChange, onDelete }: {
  field: RunParameter; index: number; issue: string | null; canMoveUp: boolean; canMoveDown: boolean;
  onMove: (offset: number) => void; onChange: (field: RunParameter) => void; onDelete: () => void;
}) {
  const id = useId();
  const type = field.type ?? "string";
  const hasDefault = field.default !== undefined && field.default !== null;
  const title = field.label || field.name || `参数 ${index + 1}`;
  const patch = (next: Partial<RunParameter>) => onChange({ ...field, ...next });
  return <section aria-label={`参数 ${index + 1}：${title}`} className="overflow-hidden rounded-lg border border-border bg-surface">
    <div className="flex items-center gap-1.5 border-b border-border/60 bg-raised/30 px-2.5 py-2">
      <span className="text-[10px] tabular-nums text-muted">{String(index + 1).padStart(2, "0")}</span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium" title={title}>{title}</span>
      <button type="button" aria-label={`上移${title}`} title="上移" disabled={!canMoveUp} onClick={() => onMove(-1)} className={action}><ArrowUp size={12} /></button>
      <button type="button" aria-label={`下移${title}`} title="下移" disabled={!canMoveDown} onClick={() => onMove(1)} className={action}><ArrowDown size={12} /></button>
      <button type="button" aria-label={`删除参数${title}`} title="删除参数" onClick={onDelete} className={`${action} hover:!text-danger`}><Trash2 size={12} /></button>
    </div>
    <div className="space-y-3 p-3">
      <label className="block text-[11px] text-text-secondary" htmlFor={`${id}-label`}>显示名称<input id={`${id}-label`} className={`${input} mt-1`} value={field.label ?? ""} placeholder="例如：采购 CSV 文件" onChange={(event) => patch({ label: event.target.value })} /></label>
      <label className="block text-[11px] text-text-secondary" htmlFor={`${id}-name`}>参数名<input id={`${id}-name`} className={`${input} mt-1 font-mono`} value={field.name} placeholder="例如：csv_path" spellCheck={false} aria-invalid={!!issue} aria-describedby={issue ? `${id}-issue` : undefined} onChange={(event) => patch({ name: event.target.value })} /><span className="mt-1 block text-[10px] text-muted">供下游引用；修改名称后需同步调整引用。</span></label>
      <div className="flex items-end gap-3">
        <label className="min-w-0 flex-1 text-[11px] text-text-secondary" htmlFor={`${id}-type`}>类型<Select id={`${id}-type`} className={`${input} mt-1`} value={type} onValueChange={(selectedValue) => onChange(changeParameterType(field, selectedValue as NonNullable<RunParameter["type"]>))}>{parameterTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></label>
        <label className="flex h-[34px] shrink-0 items-center gap-1.5 text-xs"><input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={field.required !== false} onChange={(event) => patch({ required: event.target.checked })} />必填</label>
      </div>
      <div>
        <label className="flex items-center gap-1.5 text-[11px] text-text-secondary"><input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={hasDefault} onChange={(event) => {
          if (!event.target.checked) { const next = { ...field }; delete next.default; onChange(next); }
          else patch({ default: type === "boolean" ? false : type === "integer" || type === "number" ? 0 : type === "json" ? {} : field.options?.[0] ?? "" });
        }} />设置默认值</label>
        {hasDefault && <div className="mt-2"><ParameterDefault key={`${type}:${field.name}`} field={field} onChange={(value) => patch({ default: value })} /></div>}
      </div>
      {type === "string" && <div className="space-y-1.5">
        <div className="flex items-center justify-between"><span className="text-[11px] text-text-secondary">可选值</span><button type="button" onClick={() => patch({ options: [...(field.options ?? []), ""] })} className="flex items-center gap-1 text-[10px] text-primary hover:underline"><Plus size={11} />添加选项</button></div>
        {!field.options?.length && <p className="text-[10px] text-muted">留空可自由输入；添加后显示为下拉选择。</p>}
        {field.options?.map((option, optionIndex) => <div key={optionIndex} className="flex items-center gap-1"><input aria-label={`选项 ${optionIndex + 1}`} className={input} value={option} onChange={(event) => patch({ options: field.options!.map((item, i) => i === optionIndex ? event.target.value : item) })} /><button type="button" aria-label={`删除选项 ${optionIndex + 1}`} onClick={() => patch({ options: field.options!.filter((_, i) => i !== optionIndex) })} className={action}><Trash2 size={12} /></button></div>)}
      </div>}
      <label className="block text-[11px] text-text-secondary" htmlFor={`${id}-description`}>填写说明<span className="ml-1 text-muted">（可选）</span><input id={`${id}-description`} className={`${input} mt-1`} value={field.description ?? ""} placeholder="帮助运行者填写这个参数" onChange={(event) => patch({ description: event.target.value })} /></label>
      {issue && <p id={`${id}-issue`} role="alert" className="text-[10px] leading-relaxed text-danger">{issue}</p>}
    </div>
  </section>;
}

function ParameterDefault({ field, onChange }: { field: RunParameter; onChange: (value: unknown) => void }) {
  const type = field.type ?? "string";
  if (type === "boolean") return <Select aria-label="默认值" className={input} value={String(field.default)} onValueChange={(selectedValue) => onChange(selectedValue === "true")}><option value="true">是</option><option value="false">否</option></Select>;
  if (type === "number" || type === "integer") return <NumberInput aria-label="默认值" step={type === "integer" ? 1 : 0.01} value={String(field.default)} onValueChange={(value) => { if (value !== "" && Number.isFinite(Number(value))) onChange(Number(value)); }} className="w-full" />;
  if (type === "json") return <JsonDefault value={field.default} onChange={onChange} />;
  if (field.options?.length) return <Select aria-label="默认值" className={input} value={String(field.default ?? "")} onValueChange={(selectedValue) => onChange(selectedValue)}><option value="">请选择默认值</option>{field.options.map((option, index) => <option key={index} value={option}>{option || "（未填写选项）"}</option>)}</Select>;
  return <input aria-label="默认值" type={type === "date" ? "date" : "text"} className={input} value={String(field.default ?? "")} onChange={(event) => onChange(event.target.value)} />;
}

function JsonDefault({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState("");
  useEffect(() => { setText(JSON.stringify(value, null, 2)); setError(""); }, [value]);
  const pending = text !== JSON.stringify(value, null, 2);
  return <div className="space-y-2"><textarea aria-label="结构化默认值" rows={4} className={`${input} h-auto py-2 font-mono`} value={text} onChange={(event) => { setText(event.target.value); setError(""); }} />{pending && <><p className="text-[10px] text-warning">修改尚未应用到默认值。</p><button type="button" className="text-[11px] text-primary" onClick={() => { try { onChange(JSON.parse(text)); setError(""); } catch { setError("请输入有效的 JSON 数据。"); } }}>应用默认值</button></>}{error && <p role="alert" className="text-[10px] text-danger">{error}</p>}</div>;
}
