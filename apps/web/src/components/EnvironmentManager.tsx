import { useMemo, useState } from "react";
import { Trash2, X } from "lucide-react";
import type {
  CredentialSummary,
  JsonValue,
  ProjectEnvironment,
  ProjectEnvironmentCreateRequest,
  ProjectEnvironmentUpdateRequest,
} from "../types";

type EnvironmentManagerProps = {
  credentials: CredentialSummary[];
  environments: ProjectEnvironment[];
  disabled?: boolean;
  onClose: () => void;
  onCreate: (request: ProjectEnvironmentCreateRequest) => Promise<void>;
  onUpdate: (environmentId: string, request: ProjectEnvironmentUpdateRequest) => Promise<void>;
  onDelete: (environmentId: string) => Promise<void>;
};

export function EnvironmentManager({
  credentials,
  environments,
  disabled = false,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: EnvironmentManagerProps) {
  const [editing, setEditing] = useState<ProjectEnvironment | null>(null);
  const [name, setName] = useState("");
  const [variablesText, setVariablesText] = useState("{}");
  const [credentialOverrides, setCredentialOverrides] = useState<Record<string, string>>({});
  const [sourceCredentialId, setSourceCredentialId] = useState("");
  const [targetCredentialId, setTargetCredentialId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const credentialById = useMemo(() => new Map(credentials.map((credential) => [credential.id, credential])), [credentials]);
  const sourceCredential = credentialById.get(sourceCredentialId);
  const compatibleTargets = sourceCredential
    ? credentials.filter((credential) => credential.type_id === sourceCredential.type_id && credential.id !== sourceCredential.id)
    : [];

  function resetForm() {
    setEditing(null);
    setName("");
    setVariablesText("{}");
    setCredentialOverrides({});
    setSourceCredentialId("");
    setTargetCredentialId("");
    setError(null);
  }

  function edit(environment: ProjectEnvironment) {
    setEditing(environment);
    setName(environment.name);
    setVariablesText(JSON.stringify(environment.variables, null, 2));
    setCredentialOverrides(environment.credential_overrides ?? {});
    setSourceCredentialId("");
    setTargetCredentialId("");
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || isSaving || !name.trim()) {
      return;
    }
    let variables: Record<string, JsonValue>;
    try {
      const parsed: unknown = JSON.parse(variablesText);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error();
      }
      variables = parsed as Record<string, JsonValue>;
    } catch {
      setError("环境变量必须是 JSON 对象。");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      if (editing) {
        await onUpdate(editing.id, {
          name: name.trim(),
          ...(editing.is_default ? {} : { variables }),
          credential_overrides: credentialOverrides,
        });
      } else {
        await onCreate({ name: name.trim(), variables, credential_overrides: credentialOverrides });
      }
      resetForm();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "环境保存失败。");
    } finally {
      setIsSaving(false);
    }
  }

  function addCredentialOverride() {
    if (!sourceCredentialId || !targetCredentialId || sourceCredentialId === targetCredentialId) {
      return;
    }
    setCredentialOverrides((current) => ({ ...current, [sourceCredentialId]: targetCredentialId }));
    setSourceCredentialId("");
    setTargetCredentialId("");
  }

  return (
    <section aria-label="环境管理" aria-modal="true" className="credential-manager project-variable-manager" role="dialog">
      <header className="credential-manager-header">
        <div>
          <h2>运行环境</h2>
          <p>为同一工作流保存不同的变量和凭据映射。</p>
        </div>
        <button aria-label="关闭环境管理" className="icon-button" type="button" onClick={onClose}>
          <X aria-hidden="true" size={18} strokeWidth={2} />
        </button>
      </header>
      <div className="credential-manager-body">
        <section aria-label="已保存运行环境" className="credential-list">
          <div className="credential-list-heading">
            <strong>已保存环境</strong>
            <span>{environments.length}</span>
          </div>
          <ul>
            {environments.map((environment) => (
              <li key={environment.id}>
                <div>
                  <strong>{environment.name}</strong>
                  <small className="project-variable-value-preview">
                    {environment.is_default
                      ? `默认环境 · ${(environment.credential_overrides ? Object.keys(environment.credential_overrides).length : 0)} 个凭据映射`
                      : `${Object.keys(environment.variables).length} 个变量 · ${(environment.credential_overrides ? Object.keys(environment.credential_overrides).length : 0)} 个凭据映射`}
                  </small>
                </div>
                <div className="credential-item-actions">
                  <button disabled={disabled} type="button" onClick={() => edit(environment)}>
                    编辑
                  </button>
                  {!environment.is_default ? (
                    <button className="danger-button" disabled={disabled} type="button" onClick={() => void onDelete(environment.id)}>
                      删除
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <form aria-label="运行环境表单" className="credential-form" onSubmit={(event) => void submit(event)}>
          <div className="credential-form-heading">
            <strong>{editing ? "编辑运行环境" : "新建运行环境"}</strong>
            {editing ? <button disabled={disabled || isSaving} type="button" onClick={resetForm}>新建环境</button> : null}
          </div>
          <label className="field">
            <span className="field-label">环境名称</span>
            <input aria-label="环境名称" disabled={disabled || isSaving} maxLength={120} value={name} onChange={(event) => setName(event.currentTarget.value)} />
          </label>
          <label className="field">
            <span className="field-label">环境变量 JSON</span>
            <textarea aria-label="环境变量 JSON" disabled={disabled || isSaving || Boolean(editing?.is_default)} rows={8} spellCheck={false} value={variablesText} onChange={(event) => setVariablesText(event.currentTarget.value)} />
          </label>
          {editing?.is_default ? <p className="credential-form-note">默认环境变量请在“项目变量”中维护。</p> : null}
          <fieldset className="environment-credential-mapping">
            <legend>凭据映射</legend>
            {Object.entries(credentialOverrides).length > 0 ? (
              <ul aria-label="环境凭据映射">
                {Object.entries(credentialOverrides).map(([sourceId, targetId]) => {
                  const source = credentialById.get(sourceId);
                  const target = credentialById.get(targetId);
                  return (
                    <li key={sourceId}>
                      <span>{source?.name ?? "已移除凭据"}</span>
                      <span aria-hidden="true">→</span>
                      <span>{target?.name ?? "已移除凭据"}</span>
                      <button
                        aria-label={`移除 ${source?.name ?? "凭据"} 映射`}
                        className="icon-button"
                        disabled={disabled || isSaving}
                        title="移除凭据映射"
                        type="button"
                        onClick={() => setCredentialOverrides((current) => {
                          const next = { ...current };
                          delete next[sourceId];
                          return next;
                        })}
                      >
                        <Trash2 aria-hidden="true" size={15} strokeWidth={2} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className="environment-credential-mapping-add">
              <select
                aria-label="工作流凭据"
                disabled={disabled || isSaving || credentials.length === 0}
                value={sourceCredentialId}
                onChange={(event) => {
                  setSourceCredentialId(event.currentTarget.value);
                  setTargetCredentialId("");
                }}
              >
                <option value="">工作流凭据</option>
                {credentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.name}</option>)}
              </select>
              <select
                aria-label="环境实际凭据"
                disabled={disabled || isSaving || !sourceCredential || compatibleTargets.length === 0}
                value={targetCredentialId}
                onChange={(event) => setTargetCredentialId(event.currentTarget.value)}
              >
                <option value="">环境实际凭据</option>
                {compatibleTargets.map((credential) => <option key={credential.id} value={credential.id}>{credential.name}</option>)}
              </select>
              <button disabled={disabled || isSaving || !sourceCredentialId || !targetCredentialId} type="button" onClick={addCredentialOverride}>
                添加映射
              </button>
            </div>
          </fieldset>
          {error ? <p className="credential-error" role="alert">{error}</p> : null}
          <div className="credential-form-actions">
            <button disabled={disabled || isSaving || !name.trim()} type="submit">{isSaving ? "正在保存" : "保存环境"}</button>
          </div>
        </form>
      </div>
    </section>
  );
}
