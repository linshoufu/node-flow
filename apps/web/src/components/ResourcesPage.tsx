import { useState, useEffect, useCallback } from "react";
import { Globe, KeyRound, PanelsTopLeft, SlidersHorizontal, Variable } from "lucide-react";
import { apiClient } from "@/api/client";
import type { CredentialReference, CredentialSummary, CredentialType, HttpProfile, JsonValue, ProjectVariable, ProjectEnvironment } from "@/types";
import { toast } from "./Toaster";
import { NodeStudio } from "./NodeStudio";
import { NumberInput } from "./NumberInput";

type ResSection = "credentials" | "variables" | "environments" | "httpProfiles" | "nodeStudio";

export function ResourcesPage() {
  const [section, setSection] = useState<ResSection>("credentials");
  const [credTypes, setCredTypes] = useState<CredentialType[]>([]);
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [variables, setVariables] = useState<ProjectVariable[]>([]);
  const [envs, setEnvs] = useState<ProjectEnvironment[]>([]);
  const [httpProfiles, setHttpProfiles] = useState<HttpProfile[]>([]);
  const [selectedCredential, setSelectedCredential] = useState<CredentialSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const loadCredentials = useCallback(async () => {
    setLoading(true);
    try {
      const [cts, creds] = await Promise.all([
        apiClient.listCredentialTypes(),
        apiClient.listCredentials(),
      ]);
      setCredTypes(cts);
      setCredentials(creds);
    } catch {}
    setLoading(false);
  }, []);

  const loadVariables = useCallback(async () => {
    try { setVariables(await apiClient.listProjectVariables()); } catch {}
  }, []);

  const loadEnvs = useCallback(async () => {
    try { setEnvs(await apiClient.listProjectEnvironments()); } catch {}
  }, []);
  const loadHttpProfiles = useCallback(async () => {
    try { setHttpProfiles(await apiClient.listHttpProfiles()); } catch { toast("无法加载 HTTP 配置档", "error"); }
  }, []);

  useEffect(() => { loadCredentials(); loadVariables(); loadEnvs(); loadHttpProfiles(); }, [loadCredentials, loadVariables, loadEnvs, loadHttpProfiles]);

  const deleteCredential = async (id: string) => {
    if (!confirm("确认删除凭据？")) return;
    try {
      await apiClient.deleteCredential(id);
      setCredentials((p) => p.filter((c) => c.id !== id));
      toast("已删除", "success");
    } catch { toast("删除失败", "error"); }
  };

  return (
    <div className="resources-page flex h-full min-h-0 min-w-0">
      {/* Nav */}
      <nav aria-label="资源导航" className="resource-nav flex w-44 shrink-0 flex-col border-r bg-surface">
        <div className="resource-nav-heading p-4 border-b">
          <div className="text-sm font-semibold">资源中心</div>
          <div className="text-xs text-muted mt-0.5">管理依赖</div>
        </div>
      <div className="flex-1 p-2 flex flex-col gap-1">
          {[
            { k: "nodeStudio" as const, Icon: PanelsTopLeft, label: "节点工作室" },
            { k: "credentials" as const, Icon: KeyRound, label: "凭据管理" },
            { k: "httpProfiles" as const, Icon: Globe, label: "HTTP 配置档" },
            { k: "variables" as const, Icon: Variable, label: "项目变量" },
            { k: "environments" as const, Icon: SlidersHorizontal, label: "运行环境" },
          ].map(({ k, Icon, label }) => (
            <button
              key={k}
              aria-label={label}
              aria-current={section === k ? "page" : undefined}
              title={label}
              onClick={() => setSection(k)}
              className={`flex items-center gap-2.5 text-left px-3 py-2.5 rounded-lg text-xs transition ${
                section === k
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted hover:text-text hover:bg-raised"
              }`}
            >
              <Icon size={16} className="shrink-0" /><span className="resource-nav-label">{label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <div className={`resource-content min-h-0 min-w-0 flex-1 ${section === "nodeStudio" ? "overflow-hidden" : "resource-page-body overflow-y-auto p-6"}`}>
        {section === "nodeStudio" ? <NodeStudio /> : section === "credentials" ? (
          <div>
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-lg font-semibold">凭据管理</h2>
                <p className="text-xs text-muted mt-1">DPAPI 加密存储 · {credentials.length} 条</p>
              </div>
              <button
                onClick={async () => {
                  try {
                    const name = prompt("凭据名称：");
                    if (!name || !credTypes[0]) return;
                    await apiClient.createCredential({ type_id: credTypes[0].id, name, data: {} });
                    await loadCredentials();
                    toast("已创建", "success");
                  } catch { toast("创建失败", "error"); }
                }}
                className="px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:opacity-90"
              >
                + 新建
              </button>
            </div>
            <div className="resource-cards grid gap-3">
              {credentials.map((c) => (
                <div key={c.id} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center text-primary"><KeyRound size={16} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{c.name}</div>
                      <div className="text-[10px] text-muted">{c.type_id}</div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2 pt-2 border-t border-border/30">
                    <button onClick={() => setSelectedCredential(c)} className="text-[11px] text-primary hover:underline">查看 / 编辑</button>
                    <button onClick={() => deleteCredential(c.id)} className="text-[11px] text-muted hover:text-red-400">删除</button>
                  </div>
                </div>
              ))}
              {credentials.length === 0 && (
                <div className="col-span-full text-center text-muted py-8 text-xs">暂无凭据，点击"新建"添加</div>
              )}
            </div>
            {selectedCredential && <CredentialEditor credential={selectedCredential} credentialTypes={credTypes} onClose={() => setSelectedCredential(null)} onSaved={async () => { await loadCredentials(); setSelectedCredential(null); }} />}
          </div>
        ) : section === "httpProfiles" ? (
          <HttpProfilesPanel profiles={httpProfiles} credentials={credentials} reload={loadHttpProfiles} />
        ) : section === "variables" ? (
          <div>
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-lg font-semibold">项目变量</h2>
                <p className="text-xs text-muted mt-1">跨工作流全局变量 · {variables.length} 个</p>
              </div>
              <button
                onClick={async () => {
                  try {
                    const name = prompt("变量名：");
                    if (!name) return;
                    await apiClient.createProjectVariable({ name, value: "" });
                    await loadVariables();
                    toast("已创建", "success");
                  } catch { toast("创建失败", "error"); }
                }}
                className="px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:opacity-90"
              >
                + 新建
              </button>
            </div>
            <div className="space-y-2">
              {variables.map((v) => (
                <div key={v.name} className="resource-variable flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
                  <code className="text-xs font-mono text-primary w-48 shrink-0 truncate">{v.name}</code>
                  <code className="text-xs font-mono text-muted flex-1 truncate">{typeof v.value === "string" ? v.value : JSON.stringify(v.value)}</code>
                  <button
                    onClick={async () => {
                      try { await apiClient.deleteProjectVariable(v.name); await loadVariables(); toast("已删除", "success"); } catch {}
                    }}
                    className="text-[11px] text-muted hover:text-red-400 shrink-0"
                  >
                    删除
                  </button>
                </div>
              ))}
              {variables.length === 0 && (
                <div className="text-center text-muted py-8 text-xs">暂无项目变量</div>
              )}
            </div>
          </div>
        ) : (
          <div>
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-lg font-semibold">运行环境</h2>
                <p className="text-xs text-muted mt-1">{envs.length} 个环境</p>
              </div>
            </div>
            {envs.map((env) => (
              <div key={env.id} className="rounded-lg border border-border bg-surface p-3 mb-2 flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-sm font-semibold">{env.name}</div>
                  <div className="text-[10px] text-muted">
                    {env.is_default ? "默认环境" : ""}
                    {Object.keys(env.variables ?? {}).length > 0 ? ` · ${Object.keys(env.variables).length} 个变量` : ""}
                  </div>
                </div>
              </div>
            ))}
            {envs.length === 0 && <div className="text-center text-muted py-8 text-xs">暂无运行环境</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function HttpProfilesPanel({ profiles, credentials, reload }: { profiles: HttpProfile[]; credentials: CredentialSummary[]; reload: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [headers, setHeaders] = useState("{}");
  const [credentialId, setCredentialId] = useState("");
  const [timeout, setTimeoutValue] = useState("");
  const [authentication, setAuthentication] = useState("{}");
  const [saving, setSaving] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<HttpProfile | null>(null);

  const create = async () => {
    if (!name.trim()) { toast("请填写配置档名称", "error"); return; }
    let parsedHeaders: Record<string, string>;
    try { parsedHeaders = JSON.parse(headers || "{}"); }
    catch { toast("公共请求头必须是 JSON 对象", "error"); return; }
    if (!parsedHeaders || Array.isArray(parsedHeaders) || typeof parsedHeaders !== "object") { toast("公共请求头必须是 JSON 对象", "error"); return; }
    let parsedAuthentication: Record<string, JsonValue>;
    try { parsedAuthentication = JSON.parse(authentication || "{}"); }
    catch { toast("认证策略必须是 JSON 对象", "error"); return; }
    if (!parsedAuthentication || Array.isArray(parsedAuthentication) || typeof parsedAuthentication !== "object") { toast("认证策略必须是 JSON 对象", "error"); return; }
    setSaving(true);
    try {
      await apiClient.createHttpProfile({
        name: name.trim(), base_url: baseUrl.trim(), headers: parsedHeaders,
        credential_id: credentialId || null, timeout_seconds: timeout ? Number(timeout) : null, authentication: parsedAuthentication,
      });
      setName(""); setBaseUrl(""); setHeaders("{}"); setCredentialId(""); setTimeoutValue(""); setAuthentication("{}");
      await reload(); window.dispatchEvent(new Event("nodeflow:http-profiles-changed")); toast("HTTP 配置档已创建", "success");
    } catch (error) { toast(error instanceof Error ? error.message : "创建失败", "error"); }
    finally { setSaving(false); }
  };

  return <div className="mx-auto max-w-4xl">
    <div className="mb-6"><h2 className="text-lg font-semibold">HTTP 配置档</h2><p className="mt-1 text-xs text-muted">复用 Base URL、公共请求头、HTTP 凭据和默认超时。仅 HTTP 请求节点会读取它。</p></div>
    <section className="rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold">新建配置档</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-xs text-muted">名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：测试环境 API" className="mt-1 w-full rounded border border-border bg-raised px-2.5 py-2 text-xs text-text outline-none focus:border-primary" /></label>
        <label className="text-xs text-muted">Base URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com" className="mt-1 w-full rounded border border-border bg-raised px-2.5 py-2 text-xs text-text outline-none focus:border-primary" /></label>
        <label className="text-xs text-muted">凭据<select value={credentialId} onChange={(event) => setCredentialId(event.target.value)} className="mt-1 w-full rounded border border-border bg-raised px-2.5 py-2 text-xs text-text outline-none focus:border-primary"><option value="">不使用凭据</option>{credentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.name} · {credential.type_id}</option>)}</select></label>
        <div className="text-xs text-muted"><span className="mb-1.5 block">默认超时（秒）</span><NumberInput aria-label="默认超时（秒）" min={1} max={300} value={timeout} onValueChange={setTimeoutValue} placeholder="30" className="w-full" /></div>
      </div>
      <label className="mt-3 block text-xs text-muted">公共请求头（JSON）<textarea rows={3} value={headers} onChange={(event) => setHeaders(event.target.value)} placeholder={'{ "Accept": "application/json" }'} className="mt-1 w-full rounded border border-border bg-raised px-2.5 py-2 font-mono text-xs text-text outline-none focus:border-primary" /></label>
      <label className="mt-3 block text-xs text-muted">认证策略（JSON，可选）<textarea rows={4} value={authentication} onChange={(event) => setAuthentication(event.target.value)} placeholder={'{ "mode": "login", "login": { "method": "POST", "path": "/login", "body": { "username": "{{ credential.username }}" }, "extract": { "source": "json", "path": "data.token", "target": "header", "name": "Authorization" } } }'} className="mt-1 w-full rounded border border-border bg-raised px-2.5 py-2 font-mono text-xs text-text outline-none focus:border-primary" /></label>
      <p className="mt-2 text-[11px] text-muted">认证 Header 请使用 HTTP 凭据保存，避免把令牌写入明文配置。</p>
      <button onClick={() => void create()} disabled={saving} className="mt-3 rounded bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50">{saving ? "正在创建…" : "创建配置档"}</button>
    </section>
    <div className="mt-5 space-y-2">
      {profiles.map((profile) => <article key={profile.id} className="http-profile-card flex items-center gap-3 rounded-lg border border-border bg-surface p-3"><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{profile.name}</h3><p className="mt-0.5 truncate font-mono text-[11px] text-primary">{profile.base_url || "仅公共请求头"}</p><p className="mt-1 text-[11px] text-muted">{Object.keys(profile.headers).length} 个公共请求头 · {profile.credential_id ? "已绑定凭据" : "无凭据"} · {profile.timeout_seconds ? `${profile.timeout_seconds}s` : "节点默认超时"}</p></div><button onClick={() => setSelectedProfile(profile)} className="text-xs text-primary hover:text-primary-foreground">查看 / 编辑</button><button onClick={async () => { if (!confirm(`删除配置档“${profile.name}”？`)) return; try { await apiClient.deleteHttpProfile(profile.id); await reload(); window.dispatchEvent(new Event("nodeflow:http-profiles-changed")); toast("已删除", "success"); } catch (error) { toast(error instanceof Error ? error.message : "删除失败", "error"); } }} className="text-xs text-muted hover:text-danger">删除</button></article>)}
      {profiles.length === 0 && <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted">还没有 HTTP 配置档。创建后可在 HTTP 请求节点中选择。</div>}
    </div>
    {selectedProfile && <HttpProfileEditor profile={selectedProfile} credentials={credentials} onClose={() => setSelectedProfile(null)} onSaved={async () => { await reload(); window.dispatchEvent(new Event("nodeflow:http-profiles-changed")); setSelectedProfile(null); }} />}
  </div>;
}

function CredentialEditor({ credential, credentialTypes, onClose, onSaved }: { credential: CredentialSummary; credentialTypes: CredentialType[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const credentialType = credentialTypes.find((item) => item.id === credential.type_id);
  const [name, setName] = useState(credential.name);
  const [replaceData, setReplaceData] = useState(false);
  const [data, setData] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<CredentialReference[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setName(credential.name); setReplaceData(false); setData({}); void apiClient.listCredentialReferences(credential.id).then(setReferences).catch(() => setReferences([])); }, [credential]);
  const save = async () => {
    if (!name.trim()) { toast("请填写凭据名称", "error"); return; }
    if (replaceData && credentialType?.fields.some((field) => !data[field.id]?.trim())) { toast("请重新填写所有凭据字段", "error"); return; }
    setSaving(true);
    try { await apiClient.updateCredential(credential.id, { name: name.trim(), ...(replaceData ? { data } : {}) }); toast("凭据已保存", "success"); await onSaved(); }
    catch (error) { toast(error instanceof Error ? error.message : "保存失败", "error"); }
    finally { setSaving(false); }
  };

  return <section className="mt-5 rounded-lg border border-primary/35 bg-raised/45 p-4" aria-label="编辑凭据"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">查看 / 编辑凭据</h3><p className="mt-1 text-[11px] text-muted">类型：{credential.type_id}。秘密值经过加密保存，出于安全原因不能回显。</p></div><button onClick={onClose} className="text-xs text-muted hover:text-text">关闭</button></div><div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-xs text-muted">名称<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded border border-border bg-surface px-2.5 py-2 text-xs text-text outline-none focus:border-primary" /></label><label className="flex items-end gap-2 pb-2 text-xs text-text-secondary"><input type="checkbox" checked={replaceData} onChange={(event) => setReplaceData(event.target.checked)} className="accent-primary" />重新填写并替换凭据值</label></div>{replaceData && <div className="mt-3 grid gap-3 md:grid-cols-2">{credentialType?.fields.map((field) => <label key={field.id} className="text-xs text-muted">{field.label}<input type={field.secret ? "password" : "text"} value={data[field.id] ?? ""} onChange={(event) => setData((current) => ({ ...current, [field.id]: event.target.value }))} placeholder="请输入新值" className="mt-1 w-full rounded border border-border bg-surface px-2.5 py-2 text-xs text-text outline-none focus:border-primary" /></label>)}</div>}<div className="mt-4 border-t border-border/70 pt-3"><p className="text-[11px] text-muted">引用情况</p>{references.length ? <ul className="mt-1 space-y-1 text-[11px] text-text-secondary">{references.map((reference) => <li key={`${reference.workflow_id}:${reference.node_id}`}>{reference.workflow_name} · 节点 {reference.node_label}</li>)}</ul> : <p className="mt-1 text-[11px] text-muted">当前未被工作流引用。</p>}</div><div className="mt-4 flex justify-end gap-2"><button onClick={onClose} className="rounded px-3 py-2 text-xs text-muted hover:bg-surface">取消</button><button onClick={() => void save()} disabled={saving} className="rounded bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50">{saving ? "正在保存…" : "保存凭据"}</button></div></section>;
}

function HttpProfileEditor({ profile, credentials, onClose, onSaved }: { profile: HttpProfile; credentials: CredentialSummary[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(profile.name);
  const [baseUrl, setBaseUrl] = useState(profile.base_url);
  const [headers, setHeaders] = useState(JSON.stringify(profile.headers, null, 2));
  const [credentialId, setCredentialId] = useState(profile.credential_id ?? "");
  const [timeout, setTimeoutValue] = useState(profile.timeout_seconds?.toString() ?? "");
  const [authentication, setAuthentication] = useState(JSON.stringify(profile.authentication, null, 2));
  const [saving, setSaving] = useState(false);

  useEffect(() => { setName(profile.name); setBaseUrl(profile.base_url); setHeaders(JSON.stringify(profile.headers, null, 2)); setCredentialId(profile.credential_id ?? ""); setTimeoutValue(profile.timeout_seconds?.toString() ?? ""); setAuthentication(JSON.stringify(profile.authentication, null, 2)); }, [profile]);
  const save = async () => {
    let parsedHeaders: Record<string, string>;
    let parsedAuthentication: Record<string, JsonValue>;
    try { parsedHeaders = JSON.parse(headers || "{}"); parsedAuthentication = JSON.parse(authentication || "{}"); } catch { toast("请求头和认证策略必须是 JSON 对象", "error"); return; }
    if (!parsedHeaders || Array.isArray(parsedHeaders) || typeof parsedHeaders !== "object" || !parsedAuthentication || Array.isArray(parsedAuthentication) || typeof parsedAuthentication !== "object") { toast("请求头和认证策略必须是 JSON 对象", "error"); return; }
    setSaving(true);
    try { await apiClient.updateHttpProfile(profile.id, { name: name.trim(), base_url: baseUrl.trim(), headers: parsedHeaders, credential_id: credentialId || null, timeout_seconds: timeout ? Number(timeout) : null, authentication: parsedAuthentication }); toast("HTTP 配置档已保存", "success"); await onSaved(); }
    catch (error) { toast(error instanceof Error ? error.message : "保存失败", "error"); }
    finally { setSaving(false); }
  };

  return <section className="mt-5 rounded-lg border border-primary/35 bg-raised/45 p-4" aria-label="编辑 HTTP 配置档"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">查看 / 编辑 HTTP 配置档</h3><p className="mt-1 text-[11px] text-muted">公共请求头和认证策略可查看、修改；认证凭据以关联关系展示。</p></div><button onClick={onClose} className="text-xs text-muted hover:text-text">关闭</button></div><div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-xs text-muted">名称<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded border border-border bg-surface px-2.5 py-2 text-xs text-text outline-none focus:border-primary" /></label><label className="text-xs text-muted">Base URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} className="mt-1 w-full rounded border border-border bg-surface px-2.5 py-2 text-xs text-text outline-none focus:border-primary" /></label><label className="text-xs text-muted">凭据<select value={credentialId} onChange={(event) => setCredentialId(event.target.value)} className="mt-1 w-full rounded border border-border bg-surface px-2.5 py-2 text-xs text-text outline-none focus:border-primary"><option value="">不使用凭据</option>{credentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.name} · {credential.type_id}</option>)}</select></label><div className="text-xs text-muted"><span className="mb-1.5 block">默认超时（秒）</span><NumberInput aria-label="默认超时（秒）" min={1} max={300} value={timeout} onValueChange={setTimeoutValue} className="w-full" /></div></div><label className="mt-3 block text-xs text-muted">公共请求头（JSON）<textarea rows={5} value={headers} onChange={(event) => setHeaders(event.target.value)} className="mt-1 w-full rounded border border-border bg-surface px-2.5 py-2 font-mono text-xs text-text outline-none focus:border-primary" /></label><label className="mt-3 block text-xs text-muted">认证策略（JSON）<textarea rows={6} value={authentication} onChange={(event) => setAuthentication(event.target.value)} className="mt-1 w-full rounded border border-border bg-surface px-2.5 py-2 font-mono text-xs text-text outline-none focus:border-primary" /></label><div className="mt-4 flex justify-end gap-2"><button onClick={onClose} className="rounded px-3 py-2 text-xs text-muted hover:bg-surface">取消</button><button onClick={() => void save()} disabled={saving} className="rounded bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50">{saving ? "正在保存…" : "保存配置档"}</button></div></section>;
}
