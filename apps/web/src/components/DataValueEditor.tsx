import { useEffect, useState } from "react";
import { ChevronRight, Code2, Plus, Trash2 } from "lucide-react";
import { DATA_SOURCES, expressionShape, expressionSummary, fieldExpression, isDataNumber, objectExpression } from "@/lib/dataExpressionPresentation";
import { Select } from "./Select";
import { Switch } from "./Switch";
import { TextInput } from "./TextInput";

type Props = { expression: string; onChange: (value: string) => void; label: string; depth?: number; literalOnly?: boolean };

function FixedNumber({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return <TextInput aria-label={`${label} 值`} inputMode="decimal" value={draft} onChange={(event) => {
    const next = event.target.value;
    setDraft(next);
    const valid = isDataNumber(next);
    event.target.setCustomValidity(valid ? "" : "请输入有效数值");
    if (valid) onChange(next);
  }} className="w-full" />;
}

/** Edit familiar values first; arbitrary calculations are an explicit advanced choice. */
export function DataValueEditor({ expression, onChange, label, depth = 0, literalOnly = false }: Props) {
  const [advanced, setAdvanced] = useState(false);
  const shape = expressionShape(expression);
  const complex = shape.kind === "expression";
  if (depth > 8) return <p className="text-xs text-muted">结构层级较深，请在高级配置中编辑。</p>;
  const code = <label className="block text-[11px] text-muted">计算表达式<textarea aria-label={`${label} 表达式`} rows={4} spellCheck={false} value={expression} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-canvas p-2 font-mono text-xs text-text outline-none focus:border-primary" /></label>;
  return <div className="min-w-0 space-y-2">
    {advanced ? code : complex ? <div className="rounded-lg bg-primary/5 px-3 py-2.5"><p className="text-xs text-text-secondary">此值由计算规则生成</p><p className="mt-1 text-[11px] text-muted">日常使用无需修改计算逻辑。</p></div>
      : shape.kind === "string" ? <TextInput aria-label={`${label} 值`} value={shape.value} onChange={(event) => onChange(JSON.stringify(event.target.value))} className="w-full" />
      : shape.kind === "number" ? <FixedNumber label={label} value={shape.value} onChange={onChange} />
      : shape.kind === "boolean" ? <label className="flex items-center justify-between gap-3 text-xs text-text-secondary">{label}<Switch checked={shape.value} onCheckedChange={(value) => onChange(value ? "True" : "False")} /></label>
      : shape.kind === "null" ? <div className="flex items-center justify-between text-xs text-muted"><span>未设置</span><button type="button" onClick={() => onChange("''")} className="text-primary">填写固定值</button></div>
      : shape.kind === "field" ? <div className="space-y-2"><Select aria-label={`${label} 数据来源`} value={shape.root} onValueChange={(root) => onChange(fieldExpression(root, shape.path, root === "row" ? shape.fallback : undefined))} className="w-full">{DATA_SOURCES.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</Select><label className="block text-[11px] text-muted">{shape.root === "row" ? "CSV 列名" : "字段路径"}<TextInput aria-label={`${label} 来源字段`} value={shape.path} onChange={(event) => onChange(fieldExpression(shape.root, event.target.value, shape.fallback))} className="mt-1 w-full" /></label></div>
      : shape.kind === "object" ? <div className="divide-y divide-border/60 rounded-lg border border-border">{shape.entries.map((entry, index) => <details key={index} className="group px-3"><summary className="flex cursor-pointer list-none items-center gap-2 py-2.5 text-xs"><ChevronRight size={12} className="shrink-0 text-muted group-open:rotate-90" /><span className="min-w-0 flex-1 truncate font-medium" title={entry.key}>{entry.key}</span><span className="max-w-[55%] truncate text-[11px] text-muted" title={expressionSummary(entry.expression)}>{expressionSummary(entry.expression)}</span></summary><div className="space-y-2 pb-3 pl-5"><label className="block text-[11px] text-muted">字段名<TextInput aria-label={`${entry.key} 字段名`} value={entry.key} onChange={(event) => { const key = event.target.value; const duplicate = shape.entries.some((item, i) => i !== index && item.key === key); event.target.setCustomValidity(duplicate ? "字段名不能重复" : ""); if (!duplicate) onChange(objectExpression(shape.entries.map((item, i) => i === index ? { ...item, key } : item))); }} className="mt-1 w-full" /></label><DataValueEditor literalOnly={literalOnly} label={entry.key} expression={entry.expression} depth={depth + 1} onChange={(value) => onChange(objectExpression(shape.entries.map((item, i) => i === index ? { ...item, expression: value } : item)))} /><button type="button" onClick={() => onChange(objectExpression(shape.entries.filter((_, i) => i !== index)))} className="flex items-center gap-1 text-[10px] text-danger"><Trash2 size={11} />移除此字段</button></div></details>)}<button type="button" className="flex w-full items-center gap-1 px-3 py-2.5 text-xs text-primary" onClick={() => { let key = "new_field"; while (shape.entries.some((entry) => entry.key === key)) key += "_"; onChange(objectExpression([...shape.entries, { key, expression: "''" }])); }}><Plus size={12} />添加字段</button></div>
      : shape.kind === "array" ? <div className="space-y-2">{shape.items.map((item, index) => <details key={index} className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-xs text-text-secondary">第 {index + 1} 项 <span className="ml-2 text-[11px] text-muted">{expressionSummary(item)}</span></summary><div className="mt-3 space-y-2"><DataValueEditor literalOnly={literalOnly} label={`${label} 第 ${index + 1} 项`} expression={item} depth={depth + 1} onChange={(value) => onChange(`[${shape.items.map((entry, i) => i === index ? value : entry).join(", ")}]`)} /><button type="button" className="text-[10px] text-danger" onClick={() => onChange(`[${shape.items.filter((_, i) => i !== index).join(", ")}]`)}>删除此项</button></div></details>)}<button type="button" className="text-xs text-primary" onClick={() => onChange(`[${[...shape.items, "''"].join(", ")}]`)}>＋ 添加一项</button></div> : null}
    {!literalOnly && <div className="flex flex-wrap gap-3">
      <button type="button" onClick={() => setAdvanced(!advanced)} className="flex items-center gap-1 text-[10px] text-muted hover:text-text"><Code2 size={11} />{advanced ? "收起表达式" : complex ? "编辑计算表达式" : "高级表达式"}</button>
      {!advanced && shape.kind !== "expression" && shape.kind !== "object" && shape.kind !== "array" && <button type="button" className="text-[10px] text-muted hover:text-text" onClick={() => onChange(shape.kind === "field" ? "''" : "inputs.input.value")}>{shape.kind === "field" ? "改用固定值" : "改用数据字段"}</button>}
    </div>}
  </div>;
}
