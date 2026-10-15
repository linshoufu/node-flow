import { Plus, Trash2 } from "lucide-react";

export function StringListEditor({ id, label, value, onChange }: { id: string; label: string; value: unknown; onChange: (value: string[] | null) => void }) {
  if (value != null && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) {
    return <p role="alert" className="text-xs text-danger">列表格式无效，需要字符串数组。</p>;
  }
  const items = (value ?? []) as string[];
  return <div id={id} className="space-y-2" role="group" aria-label={label}>
    {items.length === 0 && <p className="text-[11px] text-muted">未设置，使用默认配置。</p>}
    {items.map((item, index) => <div className="flex items-center gap-1.5" key={index}>
      <input aria-label={`${label} ${index + 1}`} value={item} onChange={(event) => onChange(items.map((current, i) => i === index ? event.target.value : current))} className="min-w-0 flex-1 rounded border border-border bg-raised px-2 py-1.5 text-xs text-text outline-none focus:border-primary" />
      <button type="button" aria-label={`删除${label} ${index + 1}`} onClick={() => { const next = items.filter((_, i) => i !== index); onChange(next.length ? next : null); }} className="rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={13} /></button>
    </div>)}
    <button type="button" onClick={() => onChange([...items, ""])} className="flex items-center gap-1 rounded px-1 py-1 text-[11px] text-primary hover:bg-primary/10"><Plus size={13} />添加一项</button>
  </div>;
}
