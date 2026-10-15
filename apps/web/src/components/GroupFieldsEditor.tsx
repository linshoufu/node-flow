import { useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { groupFieldsFromConfig, type CommonGroupField } from "@/lib/groupFields";
import { Select } from "./Select";
import { Switch } from "./Switch";
import { TextInput } from "./TextInput";

export function GroupFieldsEditor({ config, bindings, onChange }: {
  config: Record<string, unknown>; bindings?: Record<string, unknown>;
  onChange: (fields: CommonGroupField[]) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const fields = groupFieldsFromConfig(config);
  const legacyBound = Object.keys(bindings ?? {}).some((path) => ["by", "header_fields", "optional_keys"].some((key) => path === key || path.startsWith(`${key}.`)));
  const update = (index: number, patch: Partial<CommonGroupField>) => onChange(fields.map((field, i) => i === index ? { ...field, ...patch } : field));
  return <section className="mb-4">
    <h3 className="text-xs font-semibold">公共字段 <span className="ml-1 font-normal text-muted">{fields.length} 项</span></h3>
    <p className="mb-3 mt-1 text-[11px] leading-relaxed text-muted">值不同时拆成不同组，或让整组报错。未设置拆组字段时，所有记录归为一组。</p>
    {legacyBound ? <p className="rounded border border-border p-3 text-xs text-muted">此节点仍引用旧版分组配置，运行方式保持兼容。请先将下方旧字段引用改为固定值，再编辑公共字段。</p> : <>
      <div className="space-y-2">{fields.map((field, index) => <div key={index} className="rounded-lg border border-border bg-raised/40">
        <div className="flex items-center gap-1 p-2">
          <button type="button" aria-expanded={expanded === index} onClick={() => setExpanded(expanded === index ? null : index)} className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs"><ChevronDown size={12} className={expanded === index ? "" : "-rotate-90"} /><span className="truncate" title={field.name}>{field.label || field.name || "新公共字段"}</span></button>
          <Select aria-label={`${field.label || field.name || "新公共字段"}的差异处理`} className="w-[132px] shrink-0 text-xs" value={field.on_difference} onValueChange={(value) => update(index, { on_difference: value as CommonGroupField["on_difference"] })}><option value="split">值不同时拆组</option><option value="error">值不同时报错</option></Select>
          <button type="button" aria-label={`删除公共字段 ${field.label || field.name}`} className="p-1 text-muted hover:text-danger" onClick={() => { onChange(fields.filter((_, i) => i !== index)); setExpanded(null); }}><Trash2 size={12} /></button>
        </div>
        {expanded === index && <div className="space-y-3 border-t border-border/60 p-2">
          <label className="block text-[11px] text-muted">字段名<TextInput className="mt-1 w-full" value={field.name} onChange={(event) => update(index, { name: event.target.value })} /></label>
          <label className="block text-[11px] text-muted">显示名称（可选）<TextInput className="mt-1 w-full" value={field.label ?? ""} onChange={(event) => update(index, { label: event.target.value })} /></label>
          <label className="flex items-center justify-between text-xs">允许空值<Switch checked={field.allow_empty ?? false} onCheckedChange={(checked) => update(index, { allow_empty: checked })} /></label>
          <label className="flex items-center justify-between text-xs">输出到公共信息<Switch checked={field.emit ?? true} onCheckedChange={(checked) => update(index, { emit: checked })} /></label>
        </div>}
      </div>)}</div>
      <button type="button" className="mt-2 flex items-center gap-1 text-xs text-primary" onClick={() => { onChange([...fields, { name: "", on_difference: "split", allow_empty: false, emit: true }]); setExpanded(fields.length); }}><Plus size={12} />添加公共字段</button>
    </>}
  </section>;
}
