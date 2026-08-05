import { useEffect, useMemo, useState } from "react";
import type {
  CredentialCreateRequest,
  CredentialSummary,
  CredentialType,
  CredentialUpdateRequest,
} from "../types";

type CredentialManagerProps = {
  credentialTypes: CredentialType[];
  credentials: CredentialSummary[];
  disabled?: boolean;
  onClose: () => void;
  onCreate: (request: CredentialCreateRequest) => Promise<void>;
  onUpdate?: (credentialId: string, request: CredentialUpdateRequest) => Promise<void>;
  onDelete: (credentialId: string) => Promise<void>;
};

export function CredentialManager({
  credentialTypes,
  credentials,
  disabled = false,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: CredentialManagerProps) {
  const [selectedTypeId, setSelectedTypeId] = useState(credentialTypes[0]?.id ?? "");
  const [name, setName] = useState("");
  const [data, setData] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<CredentialSummary | null>(null);
  const [replaceData, setReplaceData] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedType = useMemo(
    () => credentialTypes.find((credentialType) => credentialType.id === selectedTypeId),
    [credentialTypes, selectedTypeId]
  );

  useEffect(() => {
    if (!selectedTypeId && credentialTypes[0]) {
      setSelectedTypeId(credentialTypes[0].id);
    }
  }, [credentialTypes, selectedTypeId]);

  function resetForm() {
    setEditing(null);
    setName("");
    setData({});
    setReplaceData(false);
    setError(null);
    setSelectedTypeId(credentialTypes[0]?.id ?? "");
  }

  function editCredential(credential: CredentialSummary) {
    setEditing(credential);
    setSelectedTypeId(credential.type_id);
    setName(credential.name);
    setData({});
    setReplaceData(false);
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedType || !name.trim() || isSaving || disabled) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      if (editing) {
        const request: CredentialUpdateRequest = { name: name.trim() };
        if (replaceData) {
          request.data = data;
        }
        await onUpdate?.(editing.id, request);
      } else {
        await onCreate({ type_id: selectedType.id, name: name.trim(), data });
      }
      resetForm();
    } catch (submissionError) {
      setError(formatCredentialError(submissionError));
    } finally {
      setIsSaving(false);
      setData({});
    }
  }

  async function deleteCredential(credential: CredentialSummary) {
    if (disabled || isDeletingId) {
      return;
    }
    setIsDeletingId(credential.id);
    setError(null);
    try {
      await onDelete(credential.id);
      if (editing?.id === credential.id) {
        resetForm();
      }
    } catch (deletionError) {
      setError(formatCredentialError(deletionError));
    } finally {
      setIsDeletingId(null);
    }
  }

  return (
    <section aria-label="凭据管理" aria-modal="true" className="credential-manager" role="dialog">
      <header className="credential-manager-header">
        <div>
          <h2>凭据管理</h2>
          <p>凭据仅加密保存在本机，列表不会显示令牌、密码或请求头值。</p>
        </div>
        <button aria-label="关闭凭据管理" className="icon-button" type="button" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="credential-manager-body">
        <section aria-label="已保存凭据" className="credential-list">
          <div className="credential-list-heading">
            <strong>已保存凭据</strong>
            <span>{credentials.length}</span>
          </div>
          {credentials.length === 0 ? <p className="empty-state">还没有凭据。</p> : null}
          <ul>
            {credentials.map((credential) => {
              const credentialType = credentialTypes.find((type) => type.id === credential.type_id);
              return (
                <li key={credential.id}>
                  <div>
                    <strong>{credential.name}</strong>
                    <small>{credentialType?.display_name ?? credential.type_id}</small>
                  </div>
                  <div className="credential-item-actions">
                    <button disabled={disabled} type="button" onClick={() => editCredential(credential)}>
                      编辑
                    </button>
                    <button
                      aria-label={`删除凭据 ${credential.name}`}
                      className="danger-button"
                      disabled={disabled || isDeletingId === credential.id}
                      type="button"
                      onClick={() => void deleteCredential(credential)}
                    >
                      删除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <form aria-label="凭据表单" className="credential-form" onSubmit={(event) => void submit(event)}>
          <div className="credential-form-heading">
            <strong>{editing ? "编辑凭据" : "新建凭据"}</strong>
            {editing ? (
              <button disabled={disabled || isSaving} type="button" onClick={resetForm}>
                新建凭据
              </button>
            ) : null}
          </div>
          <label className="field">
            <span className="field-label">凭据类型</span>
            <select
              aria-label="凭据类型"
              disabled={disabled || isSaving || Boolean(editing)}
              value={selectedTypeId}
              onChange={(event) => {
                setSelectedTypeId(event.currentTarget.value);
                setData({});
              }}
            >
              {credentialTypes.map((credentialType) => (
                <option key={credentialType.id} value={credentialType.id}>
                  {credentialType.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">凭据名称</span>
            <input
              aria-label="凭据名称"
              disabled={disabled || isSaving}
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          {editing ? (
            <label className="credential-replace-toggle">
              <input
                checked={replaceData}
                disabled={disabled || isSaving}
                type="checkbox"
                onChange={(event) => {
                  setReplaceData(event.currentTarget.checked);
                  setData({});
                }}
              />
              <span>替换敏感字段</span>
            </label>
          ) : null}
          {!editing || replaceData
            ? selectedType?.fields.map((field) => (
                <label className="field" key={field.id}>
                  <span className="field-label">{field.label}</span>
                  <input
                    aria-label={field.label}
                    autoComplete="off"
                    disabled={disabled || isSaving}
                    type={field.secret ? "password" : "text"}
                    value={data[field.id] ?? ""}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setData((current) => ({ ...current, [field.id]: value }));
                    }}
                  />
                </label>
              ))
            : <p className="credential-form-note">敏感字段不会回显。勾选后可输入新的值替换它们。</p>}
          {error ? <p className="credential-error" role="alert">{error}</p> : null}
          <div className="credential-form-actions">
            <button disabled={disabled || isSaving || !selectedType || !name.trim()} type="submit">
              {isSaving ? "正在保存" : "保存凭据"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function formatCredentialError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("credential_in_use") ? "凭据仍被工作流引用，无法删除。" : `操作失败：${message}`;
}
