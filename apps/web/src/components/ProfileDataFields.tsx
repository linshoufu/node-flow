import { Select } from "./Select";
import { useState } from "react";
import type { JsonSchema } from "@/types";
import { NumberInput } from "./NumberInput";

const input = "mt-1 w-full rounded border border-border bg-raised p-2 text-xs outline-none focus:border-primary";

export function profileDefaults(schema: JsonSchema): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([, field]) => field.default !== undefined).map(([key, field]) => [key, field.default]));
}

function StructuredField({ label, value, onChange }: { label: string; value: unknown; onChange: (value: unknown) => void }) {
  const [text, setText] = useState(JSON.stringify(value === undefined ? {} : value, null, 2));
  return <textarea aria-label={label} className={`${input} font-mono`} rows={6} value={text} onChange={(event) => {
    setText(event.target.value);
    try { const parsed: unknown = JSON.parse(event.target.value); event.target.setCustomValidity(""); onChange(parsed); }
    catch { event.target.setCustomValidity("请输入有效 JSON"); }
  }} />;
}

export function ProfileDataFields({ schema, value, onChange }: { schema: JsonSchema; value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  return <div className="space-y-3">{Object.entries(schema.properties ?? {}).map(([key, field]) => {
    const label = field.title ?? key;
    const branch = field.anyOf?.find((entry) => entry.type !== "null");
    const type = field.type ?? branch?.type;
    const update = (next: unknown) => onChange({ ...value, [key]: next });
    return <label key={key} className="block text-xs">{label}{schema.required?.includes(key) ? " *" : ""}
      {field.enum ? <Select aria-label={label} className={input} value={String(value[key] ?? "")} onValueChange={(selectedValue) => update(selectedValue)}><option value="">请选择</option>{field.enum.map((item) => <option key={String(item)}>{String(item)}</option>)}</Select>
        : type === "object" || type === "array" || field.$ref || branch?.$ref ? <StructuredField label={label} value={value[key]} onChange={update} />
        : type === "boolean" ? <Select aria-label={label} className={input} value={String(value[key] ?? false)} onValueChange={(selectedValue) => update(selectedValue === "true")}><option value="true">是</option><option value="false">否</option></Select>
        : type === "number" || type === "integer" ? <NumberInput aria-label={label} required={schema.required?.includes(key)} step={type === "integer" ? 1 : 0.01} min={field.minimum} max={field.maximum} className="mt-1 w-full" value={String(value[key] ?? "")} onValueChange={(next) => update(next === "" ? undefined : Number(next))} />
        : <input aria-label={label} required={schema.required?.includes(key)} className={input} value={String(value[key] ?? "")} onChange={(event) => update(event.target.value)} />}
      {field.description && <span className="mt-1 block text-muted">{field.description}</span>}
    </label>;
  })}</div>;
}
