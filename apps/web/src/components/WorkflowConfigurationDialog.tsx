import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Settings2, Trash2, X } from "lucide-react";
import { useWorkflowStore } from "@/store/workflow";
import type { RunParameter } from "@/lib/runParameters";
import { fromDataLiteral, toDataLiteral } from "@/lib/dataExpressionPresentation";
import { DataValueEditor } from "./DataValueEditor";
import { Select } from "./Select";
import { TextInput } from "./TextInput";

import { SaveLibraryAsset } from "./SaveLibraryAsset";

const EMPTY_CONFIGURATION: RunParameter[] = [];
const TYPE_LABELS: Record<string, string> = { string: "文本", integer: "整数", number: "数值", boolean: "开关", json: "结构化数据", date: "日期", file: "文件路径" };

export function WorkflowConfigurationDialog() {
  const configuration = useWorkflowStore((state) => state.workflow.settings?.configuration ?? EMPTY_CONFIGURATION);
  const setConfiguration = useWorkflowStore((state) => state.setWorkflowConfiguration);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RunParameter[]>([]);
  const [error, setError] = useState("");
  const patch = (index: number, update: Partial<RunParameter>) => setDraft(draft.map((field, i) => i === index ? { ...field, ...update } : field));
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><button type="button" aria-label="工作流设置" onClick={() => { setDraft(structuredClone(configuration)); setError(""); }} className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs text-text-secondary hover:bg-raised"><Settings2 size={14} /><span className="secondary-label">设置</span></button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/65" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[760px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-surface text-text shadow-2xl">
      <header className="flex items-start gap-3 border-b border-border p-5"><div className="flex-1"><Dialog.Title className="text-sm font-semibold">工作流设置</Dialog.Title><Dialog.Description className="mt-1 text-xs text-muted">集中管理本流程的固定配置。节点通过绑定使用；每次运行会保存独立快照。账号密码请放在凭据中。</Dialog.Description></div><Dialog.Close aria-label="关闭工作流设置"><X size={16} /></Dialog.Close></header>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); if (draft.some((field) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.name)) || new Set(draft.map((field) => field.name)).size !== draft.length) { setError("配置键必须有效且不能重复"); return; } setConfiguration(draft); setOpen(false); }}>
        <div className="min-h-0 space-y-3 overflow-y-auto p-5">
          {!draft.length && <p className="rounded-lg border border-dashed border-border p-5 text-center text-xs text-muted">还没有工作流配置。添加后，可在节点字段旁选择“引用”。</p>}
          {draft.map((field, index) => <details key={index} className="rounded-lg border border-border bg-raised/30"><summary className="cursor-pointer px-3 py-3 text-xs font-medium">{field.label || field.name || "新配置"}<span className="ml-2 text-[10px] font-normal text-muted">{TYPE_LABELS[field.type ?? "string"]}</span></summary><div className="space-y-3 border-t border-border p-3">
            <div className="grid grid-cols-2 gap-3"><label className="text-[11px] text-muted">显示名称<TextInput value={field.label ?? ""} onChange={(event) => patch(index, { label: event.target.value })} className="mt-1 w-full" /></label><label className="text-[11px] text-muted">配置键<TextInput required pattern="[A-Za-z_][A-Za-z0-9_]*" value={field.name} onChange={(event) => patch(index, { name: event.target.value })} className="mt-1 w-full font-mono" /></label></div>
            <label className="block text-[11px] text-muted">类型<Select value={field.type ?? "string"} onValueChange={(type) => patch(index, { type: type as RunParameter["type"], default: type === "json" ? {} : type === "boolean" ? false : type === "number" || type === "integer" ? 0 : "" })} className="mt-1 w-full"><option value="string">文本</option><option value="integer">整数</option><option value="number">数值</option><option value="boolean">开关</option><option value="json">对象或列表</option><option value="date">日期</option></Select></label>
            <DataValueEditor literalOnly label={field.label || field.name} expression={toDataLiteral(field.default)} onChange={(expression) => { try { patch(index, { default: fromDataLiteral(expression) }); setError(""); } catch (error) { setError(error instanceof Error ? error.message : "配置值无效"); } }} />
            <button type="button" onClick={() => setDraft(draft.filter((_, i) => i !== index))} className="flex items-center gap-1 text-[11px] text-danger"><Trash2 size={12} />删除配置</button>
          </div></details>)}
          <button type="button" onClick={() => setDraft([...draft, { name: "", label: "", type: "string", default: "", required: true }])} className="flex items-center gap-1 text-xs text-primary"><Plus size={13} />添加配置</button>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        </div>
        <footer className="flex justify-end gap-3 border-t border-border p-4"><Dialog.Close type="button" className="px-3 text-xs text-muted">取消</Dialog.Close><button type="submit" disabled={!!error} className="rounded-lg bg-primary px-4 py-2 text-xs text-white disabled:opacity-40">应用配置</button></footer>
      </form>
      <div className="border-t border-border px-5 pb-3 pt-3"><SaveLibraryAsset preset={false} templateKind="workflow" configurationOverride={draft} disabled={!!error} /></div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
