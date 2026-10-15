import { Select } from "./Select";
import { useState } from "react";
import { apiClient } from "@/api/client";
import type { CredentialType } from "@/types";

export function CreateCredentialForm({ types, onClose, onCreated }: { types: CredentialType[]; onClose: () => void; onCreated: () => Promise<void> }) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [name, setName] = useState("");
  const [data, setData] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = "mt-1 w-full rounded border border-border bg-raised p-2 text-xs text-text outline-none focus:border-primary";
  return <form className="mb-4 max-w-xl space-y-3 rounded-xl border border-border bg-surface p-4" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { await apiClient.createCredential({ type_id: typeId, name, data }); setData({}); await onCreated(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "创建凭据失败"); } finally { setBusy(false); } }}>
    <label className="block text-xs">凭据类型<Select aria-label="新建凭据类型" className={input} value={typeId} onValueChange={(selectedValue) => { setTypeId(selectedValue); setData({}); }}>{types.map((type) => <option key={type.id} value={type.id}>{type.display_name}</option>)}</Select></label>
    <label className="block text-xs">凭据名称<input aria-label="新建凭据名称" required className={input} value={name} onChange={(event) => setName(event.target.value)} /></label>
    {types.find((type) => type.id === typeId)?.fields.map((field) => <label key={field.id} className="block text-xs">{field.label}<input aria-label={field.label} required type={field.secret ? "password" : "text"} autoComplete="off" className={input} value={data[field.id] ?? ""} onChange={(event) => setData({ ...data, [field.id]: event.target.value })} /></label>)}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    <div className="flex gap-4"><button disabled={busy} className="rounded bg-primary px-3 py-2 text-xs text-white">{busy ? "正在创建…" : "创建凭据"}</button><button type="button" className="text-xs text-muted" onClick={onClose}>取消</button></div>
  </form>;
}
