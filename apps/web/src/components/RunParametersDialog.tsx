import { Select } from "./Select";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { parameterInput, type RunParameter } from "@/lib/runParameters";
import { NumberInput } from "./NumberInput";

export function RunParametersDialog({ fields, inputPath, busy, onRun, onClose }: {
  fields: RunParameter[]; inputPath?: string; busy: boolean;
  onRun: (input: Record<string, unknown>) => Promise<void>; onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.name, field.default == null ? (field.type === "boolean" ? "false" : "") : typeof field.default === "object" ? JSON.stringify(field.default) : String(field.default)])));
  const [error, setError] = useState("");
  const style = "mt-1 w-full rounded border border-border bg-raised p-2 text-xs outline-none focus:border-primary";
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/65" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[440px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-5 text-text shadow-xl"><Dialog.Title className="text-base font-semibold">运行参数</Dialog.Title><Dialog.Description className="mt-1 text-xs text-muted">确认本次运行的输入，参数将保存在运行记录中。</Dialog.Description>
    <form className="mt-4 space-y-4" onSubmit={async (event) => { event.preventDefault(); setError(""); try { await onRun(parameterInput(fields, values, inputPath)); } catch (e) { setError(e instanceof Error ? e.message : "创建运行失败"); } }}>
      {fields.map((field) => <label key={field.name} className="block text-xs">{field.label || field.name}{field.required !== false ? " *" : ""}
        {field.type === "boolean" ? <Select aria-label={field.label || field.name} className={style} value={values[field.name]} onValueChange={(selectedValue) => setValues({ ...values, [field.name]: selectedValue })}><option value="true">是</option><option value="false">否</option></Select>
          : field.options?.length ? <Select aria-label={field.label || field.name} className={style} value={values[field.name]} onValueChange={(selectedValue) => setValues({ ...values, [field.name]: selectedValue })}><option value="">请选择</option>{field.options.map((option) => <option key={option}>{option}</option>)}</Select>
          : field.type === "json" ? <textarea aria-label={field.label || field.name} required={field.required !== false} className={`${style} font-mono`} value={values[field.name]} onChange={(e) => setValues({ ...values, [field.name]: e.target.value })} />
          : field.type === "integer" || field.type === "number" ? <NumberInput aria-label={field.label || field.name} required={field.required !== false} step={field.type === "integer" ? 1 : 0.01} className="mt-1 w-full" value={values[field.name]} onValueChange={(value) => setValues({ ...values, [field.name]: value })} />
          : <input aria-label={field.label || field.name} required={field.required !== false} type={field.type === "date" ? "date" : "text"} className={style} value={values[field.name]} onChange={(e) => setValues({ ...values, [field.name]: e.target.value })} />}
        {field.description && <span className="mt-1 block text-muted">{field.description}</span>}
      </label>)}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-3"><button type="button" disabled={busy} className="text-xs text-muted" onClick={onClose}>取消</button><button disabled={busy} className="rounded bg-primary px-4 py-2 text-xs text-white disabled:opacity-40">{busy ? "正在创建…" : "开始运行"}</button></div>
    </form>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
