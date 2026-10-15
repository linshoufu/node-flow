import { useState } from "react";
import { ChevronDown, Plus, Search, Trash2 } from "lucide-react";
import { columnReferences, columnTitle, expressionShape, expressionSummary, replaceColumn } from "@/lib/dataExpressionPresentation";
import { DataValueEditor } from "./DataValueEditor";
import { Select } from "./Select";
import { Switch } from "./Switch";
import { TextInput } from "./TextInput";

export type DataRule = { name: string; expression: string; type?: string; required?: boolean; minimum?: string | null; each?: string; rules?: DataRule[]; fields?: DataRule[] };
type Props = { value: unknown; onChange: (value: DataRule[]) => void; columns?: boolean; label: string };
const TYPES: Record<string, string> = { string: "文本", decimal: "小数", date: "日期", object: "对象" };

export function DataRulesEditor({ value, onChange, columns = false, label }: Props) {
  const rules = Array.isArray(value) ? value as DataRule[] : [];
  const [active, setActive] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const patch = (index: number, key: string, value: unknown) => onChange(rules.map((rule, i) => i === index ? { ...rule, [key]: value } : rule));
  const visible = rules.map((rule, index) => ({ rule, index, title: columns ? columnTitle(rule.name, rule.expression) : rule.name || "新字段" })).filter(({ rule, title }) => `${title} ${rule.name} ${rule.expression}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-2" aria-label={label}>
    {rules.length > 6 && <div className="relative"><Search size={12} className="absolute left-2.5 top-3 text-muted" /><TextInput aria-label={`搜索${label}`} placeholder="搜索字段" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full pl-7" /></div>}
    <div className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border">
    {visible.map(({ rule, index, title }) => {
      const sourceColumns = [...new Set(columnReferences(rule.expression).map((ref) => ref.name))];
      const computedColumns = columns && sourceColumns.length > 0 && expressionShape(rule.expression).kind === "expression";
      return <div key={index}>
      <button type="button" aria-expanded={active === index} onClick={() => setActive(active === index ? null : index)} className="flex w-full min-w-0 items-center gap-2 px-2.5 py-2.5 text-left text-xs hover:bg-raised/70">
        <span className="min-w-0 flex-1 truncate font-medium" title={title}>{title}{rule.required && <span className="ml-1 text-danger" title="必填">*</span>}</span>
        <span className="max-w-[50%] truncate text-[10px] text-muted">{columns ? TYPES[rule.type ?? "string"] : rule.each ? "逐项生成" : rule.fields?.length ? `${rule.fields.length} 个子字段` : expressionSummary(rule.expression)}</span>
        <ChevronDown size={12} className={`shrink-0 text-muted ${active === index ? "rotate-180" : ""}`} />
      </button>
      {active === index && <div className="space-y-3 border-t border-border/50 bg-raised/30 p-3">
        {computedColumns ? <div className="space-y-2">{sourceColumns.map((column, sourceIndex) => <label key={sourceIndex} className="block text-[11px] text-muted">CSV 列名<TextInput aria-label={`${title} 来源字段`} value={column} onChange={(event) => patch(index, "expression", replaceColumn(rule.expression, column, event.target.value))} className="mt-1 w-full" /></label>)}<p className="text-[10px] text-muted">校验、计算和默认值规则保持不变。</p></div> : !rule.fields?.length && <DataValueEditor label={title} expression={rule.expression} onChange={(value) => patch(index, "expression", value)} />}
        {columns ? <>
          <label className="block text-[11px] text-muted">转换为<Select aria-label={`${title} 类型`} value={rule.type ?? "string"} onValueChange={(value) => patch(index, "type", value)} className="mt-1 w-full">{Object.entries(TYPES).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</Select></label>
          <label className="flex items-center justify-between text-xs text-text-secondary">必填<Switch checked={Boolean(rule.required)} onCheckedChange={(value) => patch(index, "required", value)} /></label>
          {rule.type === "decimal" && <label className="block text-[11px] text-muted">最小值（可选）<TextInput value={rule.minimum ?? ""} onChange={(event) => patch(index, "minimum", event.target.value || null)} className="mt-1 w-full" /></label>}
        </> : <>
          {!!rule.fields?.length && <DataRulesEditor label={`${title} 子字段`} value={rule.fields} onChange={(value) => patch(index, "fields", value)} />}
          {rule.each && <p className="text-[11px] text-muted">对集合中的每一项分别生成结果。</p>}
        </>}
        <details><summary className="cursor-pointer text-[10px] text-muted">高级设置</summary><div className="mt-2 space-y-3">
          <label className="block text-[11px] text-muted">内部字段名<TextInput aria-label={`${label} 字段 ${index + 1}`} value={rule.name} onChange={(event) => patch(index, "name", event.target.value)} className="mt-1 w-full font-mono" /></label>
          {computedColumns && <DataValueEditor label={title} expression={rule.expression} onChange={(value) => patch(index, "expression", value)} />}
          {!columns && <><label className="block text-[11px] text-muted">集合来源<TextInput value={rule.each ?? ""} onChange={(event) => patch(index, "each", event.target.value)} className="mt-1 w-full font-mono" /></label>
          {rule.each && <DataRulesEditor label={`${title} 中间计算`} value={rule.rules} onChange={(value) => patch(index, "rules", value)} />}
          {!rule.fields?.length && <DataRulesEditor label={`${title} 子字段`} value={rule.fields} onChange={(value) => patch(index, "fields", value)} />}</>}
          <button type="button" aria-label={`删除字段 ${rule.name}`} onClick={() => { onChange(rules.filter((_, i) => i !== index)); setActive(null); }} className="flex items-center gap-1 text-[10px] text-danger"><Trash2 size={12} />删除字段</button>
        </div></details>
      </div>}
    </div>; })}
    {!visible.length && <p className="px-3 py-4 text-xs text-muted">{rules.length ? "没有匹配的字段" : "尚未添加字段"}</p>}
    </div>
    <button type="button" onClick={() => { onChange([...rules, { name: "", expression: "''", ...(columns ? { type: "string", required: false } : {}) }]); setSearch(""); setActive(rules.length); }} className="flex items-center gap-1 py-1 text-xs text-primary"><Plus size={12} />添加字段</button>
  </div>;
}
