import { Select } from "./Select";
import { useEffect, useState } from "react";
import { apiClient } from "@/api/client";
import type { CredentialSummary, ResourceProfile, ResourceProfileType } from "@/types";
import { toast } from "./Toaster";
import { ProfileDataFields, profileDefaults } from "./ProfileDataFields";

const input = "w-full rounded border border-border bg-raised px-2 py-2 text-xs text-text outline-none focus:border-primary";

export function ResourceProfilesPanel() {
  const [profiles, setProfiles] = useState<ResourceProfile[]>([]);
  const [types, setTypes] = useState<ResourceProfileType[]>([]);
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const [data, setData] = useState("{}");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rawEditing, setRawEditing] = useState(false);
  const selectedType = types.find((item) => item.id === typeId);
  const reload = () => apiClient.listProfiles().then(setProfiles);
  useEffect(() => {
    void Promise.all([reload(), apiClient.listProfileTypes().then(setTypes), apiClient.listCredentials().then(setCredentials)])
      .catch(() => toast("无法加载业务配置档", "error"));
  }, []);

  const begin = (profile?: ResourceProfile) => {
    setEditing(profile?.id ?? ""); setName(profile?.name ?? "");
    setTypeId(profile?.type_id ?? types[0]?.id ?? "");
    setCredentialId(profile?.credential_id ?? "");
    setData(JSON.stringify(profile?.data ?? profileDefaults(types[0]?.schema ?? {}), null, 2)); setError(""); setRawEditing(false);
  };

  return <section className="max-w-3xl">
    <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-semibold">业务配置档</h2><p className="mt-1 text-xs text-muted">由节点包定义字段，供多个节点复用；账号保存在凭据库。</p></div><button className="rounded bg-primary px-3 py-2 text-xs text-white disabled:opacity-40" disabled={!types.length} onClick={() => begin()}>新建配置档</button></div>
    {!types.length && <p className="text-sm text-muted">已启用的节点包尚未声明配置档类型。</p>}
    {profiles.map((profile) => <article key={profile.id} className="mb-3 rounded-xl border border-border bg-surface p-4"><div className="text-sm font-semibold">{profile.name}</div><div className="mt-1 text-xs text-muted">{types.find((item) => item.id === profile.type_id)?.name ?? profile.type_id}</div><div className="mt-3 flex gap-4 text-xs"><button className="text-primary" onClick={() => begin(profile)}>编辑</button><button className="text-danger" onClick={async () => { if (!confirm("删除此配置档？")) return; try { await apiClient.deleteProfile(profile.id); await reload(); } catch (e) { toast(e instanceof Error ? e.message : "删除失败", "error"); } }}>删除</button></div></article>)}
    {editing !== null && <form className="mt-4 space-y-4 rounded-xl border border-border bg-surface p-4" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError("");
      try { const parsed: unknown = JSON.parse(data); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("配置内容必须是 JSON 对象"); await apiClient.saveProfile({ name, type_id: typeId, data: parsed as Record<string, unknown>, credential_id: credentialId || null }, editing || undefined); await reload(); setEditing(null); window.dispatchEvent(new Event("nodeflow:profiles-changed")); toast("配置档已保存", "success"); }
      catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } finally { setBusy(false); }
    }}>
      <label className="block text-xs">名称<input aria-label="配置档名称" required value={name} onChange={(e) => setName(e.target.value)} className={`${input} mt-1`} /></label>
      <label className="block text-xs">类型<Select aria-label="配置档类型" disabled={!!editing} value={typeId} onValueChange={(selectedValue) => { setTypeId(selectedValue); setCredentialId(""); setData(JSON.stringify(profileDefaults(types.find((item) => item.id === selectedValue)?.schema ?? {}), null, 2)); }} className={`${input} mt-1`}>{types.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
      <label className="block text-xs">凭据<Select aria-label="配置档凭据" required={!!selectedType?.credentialTypeIds.length} value={credentialId} onValueChange={(selectedValue) => setCredentialId(selectedValue)} className={`${input} mt-1`}><option value="">请选择</option>{credentials.filter((item) => !selectedType?.credentialTypeIds.length || selectedType.credentialTypeIds.includes(item.type_id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
      <button type="button" className="text-xs text-primary" onClick={() => { if (rawEditing) { try { const parsed: unknown = JSON.parse(data); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("配置必须是对象"); } catch { setError("请先修正 JSON 格式"); return; } } setRawEditing(!rawEditing); }}>{rawEditing ? "使用表单编辑" : "编辑完整 JSON"}</button>
      {rawEditing ? <label className="block text-xs">配置内容<textarea aria-label="配置内容" rows={12} value={data} onChange={(e) => setData(e.target.value)} className={`${input} mt-1 font-mono`} /></label> : selectedType && <ProfileDataFields key={`${editing}:${typeId}`} schema={selectedType.schema} value={JSON.parse(data) as Record<string, unknown>} onChange={(value) => setData(JSON.stringify(value, null, 2))} />}
      {selectedType && <details className="text-xs text-muted"><summary>查看字段要求</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap">{JSON.stringify(selectedType.schema, null, 2)}</pre></details>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex gap-3"><button disabled={busy} className="rounded bg-primary px-4 py-2 text-xs text-white">{busy ? "正在保存…" : "保存配置档"}</button><button type="button" onClick={() => setEditing(null)} className="text-xs text-muted">取消</button></div>
    </form>}
  </section>;
}
