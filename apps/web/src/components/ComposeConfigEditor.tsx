import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, Braces, Settings2, X } from "lucide-react";
import { expressionShape, expressionSummary } from "@/lib/dataExpressionPresentation";
import { DataRulesEditor, type DataRule } from "./DataRulesEditor";
import { DataValueEditor } from "./DataValueEditor";

type Props = { config: Record<string, unknown>; onChange: (key: string, value: unknown) => void };

/** Keep everyday output editing separate from the calculation machinery. */
export function ComposeConfigEditor({ config, onChange }: Props) {
  const fields = Array.isArray(config.fields) ? config.fields as DataRule[] : [];
  const rules = Array.isArray(config.rules) ? config.rules as DataRule[] : [];
  const expression = typeof config.output === "string" ? config.output : "inputs";
  const shape = expressionShape(expression);
  const count = fields.length || (shape.kind === "object" ? shape.entries.length : 0);
  const names = fields.length ? fields.map((field) => field.name) : shape.kind === "object" ? shape.entries.map((field) => field.key) : [];
  const [open, setOpen] = useState(false);
  const [draftFields, setDraftFields] = useState<DataRule[]>([]);
  const [draftExpression, setDraftExpression] = useState(expression);
  const [editingFields, setEditingFields] = useState(false);
  const start = () => { setDraftFields(structuredClone(fields)); setDraftExpression(expression); setEditingFields(fields.length > 0); setOpen(true); };
  return <div className="space-y-4 px-4 py-4">
    <div>
      <div className="flex items-center justify-between"><h3 className="text-xs font-semibold">输出内容</h3><span className="text-[10px] text-muted">{count ? `${count} 个字段` : expressionSummary(expression)}</span></div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">将输入数据整理成下一步需要的内容。</p>
      <div className="mt-3 overflow-hidden rounded-lg border border-border bg-raised/30">
        {names.slice(0, 5).map((name, index) => <div key={index} className="flex items-center gap-2 border-b border-border/40 px-3 py-2 text-xs last:border-0"><Braces size={12} className="shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate text-text-secondary">{name}</span><span className="max-w-[50%] truncate text-[10px] text-muted">{fields.length ? fields[index].fields?.length ? "对象" : fields[index].each ? "逐项生成" : expressionSummary(fields[index].expression) : shape.kind === "object" ? expressionSummary(shape.entries[index].expression) : ""}</span></div>)}
        {!names.length && <p className="px-3 py-3 text-xs text-text-secondary">{shape.kind === "expression" ? "根据输入和计算规则生成结果" : expressionSummary(expression)}</p>}
        {names.length > 5 && <p className="border-t border-border/40 px-3 py-2 text-[10px] text-muted">还有 {names.length - 5} 个字段，可在编辑时查看</p>}
      </div>
      <button type="button" onClick={start} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-primary/25 bg-primary/8 text-xs text-primary hover:bg-primary/15">编辑输出内容<ArrowRight size={13} /></button>
    </div>
    <details className="border-t border-border/60 pt-3">
      <summary className="cursor-pointer text-[11px] text-muted">高级配置{rules.length ? ` · ${rules.length} 条计算规则` : ""}</summary>
      <div className="mt-3 space-y-3"><p className="text-[11px] leading-relaxed text-muted">用于匹配、金额计算或逐项组装。修改前请确认下游需要的数据结构。</p>
        <DataRulesEditor label="中间计算规则" value={rules} onChange={(value) => onChange("rules", value)} />
        {fields.length > 0 && <p className="text-[10px] text-muted">当前按已配置的输出字段生成对象。</p>}
        {!fields.length && <details><summary className="cursor-pointer text-[10px] text-muted">输出表达式</summary><div className="mt-2"><DataValueEditor label="输出" expression={expression} onChange={(value) => onChange("output", value)} /></div></details>}
      </div>
    </details>
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[760px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-surface text-text shadow-2xl">
          <header className="flex items-start gap-3 border-b border-border p-5"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Settings2 size={18} /></div><div className="min-w-0 flex-1"><Dialog.Title className="text-sm font-semibold">编辑输出内容</Dialog.Title><Dialog.Description className="mt-1 text-xs text-muted">展开字段修改固定值或数据来源。应用后更新节点配置，不会运行工作流。</Dialog.Description></div><Dialog.Close aria-label="关闭输出编辑" className="rounded p-1 text-muted hover:bg-raised"><X size={16} /></Dialog.Close></header>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); onChange(editingFields ? "fields" : "output", editingFields ? draftFields : draftExpression); setOpen(false); }}>
            <div className="min-h-0 overflow-y-auto p-5">{editingFields ? <DataRulesEditor label="输出字段" value={draftFields} onChange={setDraftFields} /> : <DataValueEditor label="输出内容" expression={draftExpression} onChange={setDraftExpression} />}</div>
            <footer className="flex shrink-0 justify-end gap-3 border-t border-border p-4"><Dialog.Close className="rounded-lg px-4 py-2 text-xs text-muted hover:bg-raised">取消</Dialog.Close><button type="submit" className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-white hover:bg-primary/90">应用修改</button></footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
