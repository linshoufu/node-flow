import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { JsonValue, ProjectVariable, ProjectVariableCreateRequest, ProjectVariableUpdateRequest } from "../types";
import { isWorkflowVariableName, WORKFLOW_VARIABLE_NAME_ERROR } from "../lib/workflowVariables";

type ProjectVariableManagerProps = {
  variables: ProjectVariable[];
  disabled?: boolean;
  onClose: () => void;
  onCreate: (request: ProjectVariableCreateRequest) => Promise<void>;
  onUpdate: (name: string, request: ProjectVariableUpdateRequest) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
};

export function ProjectVariableManager({
  variables,
  disabled = false,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: ProjectVariableManagerProps) {
  const [editingName, setEditingName] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [valueDraft, setValueDraft] = useState('""');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingName, setIsDeletingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parsedValue = useMemo(() => parseJsonValue(valueDraft), [valueDraft]);

  function resetForm() {
    setEditingName(null);
    setName("");
    setValueDraft('""');
    setError(null);
  }

  function editVariable(variable: ProjectVariable) {
    setEditingName(variable.name);
    setName(variable.name);
    setValueDraft(JSON.stringify(variable.value, null, 2));
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || isSaving) {
      return;
    }
    if (!isWorkflowVariableName(name)) {
      setError(WORKFLOW_VARIABLE_NAME_ERROR);
      return;
    }
    if (!parsedValue.valid) {
      setError("变量值必须是有效的 JSON。");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      if (editingName) {
        await onUpdate(editingName, { value: parsedValue.value });
      } else {
        await onCreate({ name, value: parsedValue.value });
      }
      resetForm();
    } catch (submissionError) {
      setError(formatError(submissionError));
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteVariable(variable: ProjectVariable) {
    if (disabled || isDeletingName) {
      return;
    }
    setIsDeletingName(variable.name);
    setError(null);
    try {
      await onDelete(variable.name);
      if (editingName === variable.name) {
        resetForm();
      }
    } catch (deletionError) {
      setError(formatError(deletionError));
    } finally {
      setIsDeletingName(null);
    }
  }

  return (
    <section aria-label="项目变量管理" aria-modal="true" className="credential-manager project-variable-manager" role="dialog">
      <header className="credential-manager-header">
        <div>
          <h2>项目变量</h2>
          <p>仅存放非敏感配置。</p>
        </div>
        <button aria-label="关闭项目变量管理" className="icon-button" type="button" onClick={onClose}>
          <X aria-hidden="true" size={18} strokeWidth={2} />
        </button>
      </header>

      <div className="credential-manager-body">
        <section aria-label="已保存项目变量" className="credential-list">
          <div className="credential-list-heading">
            <strong>已保存变量</strong>
            <span>{variables.length}</span>
          </div>
          {variables.length === 0 ? <p className="empty-state">还没有项目变量。</p> : null}
          <ul>
            {variables.map((variable) => (
              <li key={variable.name}>
                <div>
                  <strong>{variable.name}</strong>
                  <small className="project-variable-value-preview">{formatValuePreview(variable.value)}</small>
                </div>
                <div className="credential-item-actions">
                  <button disabled={disabled} type="button" onClick={() => editVariable(variable)}>
                    编辑
                  </button>
                  <button
                    aria-label={`删除项目变量 ${variable.name}`}
                    className="danger-button"
                    disabled={disabled || isDeletingName === variable.name}
                    type="button"
                    onClick={() => void deleteVariable(variable)}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <form aria-label="项目变量表单" className="credential-form" onSubmit={(event) => void submit(event)}>
          <div className="credential-form-heading">
            <strong>{editingName ? "编辑项目变量" : "新建项目变量"}</strong>
            {editingName ? (
              <button disabled={disabled || isSaving} type="button" onClick={resetForm}>
                新建变量
              </button>
            ) : null}
          </div>
          <label className="field">
            <span className="field-label">变量名称</span>
            <input
              aria-label="变量名称"
              autoComplete="off"
              disabled={disabled || isSaving || Boolean(editingName)}
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">变量值 JSON</span>
            <textarea
              aria-label="变量值 JSON"
              disabled={disabled || isSaving}
              rows={8}
              spellCheck={false}
              value={valueDraft}
              onChange={(event) => setValueDraft(event.currentTarget.value)}
            />
          </label>
          {error ? <p className="credential-error" role="alert">{error}</p> : null}
          <div className="credential-form-actions">
            <button disabled={disabled || isSaving || !name.trim()} type="submit">
              {isSaving ? "正在保存" : "保存变量"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function parseJsonValue(value: string): { valid: true; value: JsonValue } | { valid: false } {
  try {
    return { valid: true, value: JSON.parse(value) as JsonValue };
  } catch {
    return { valid: false };
  }
}

function formatValuePreview(value: JsonValue): string {
  const preview = JSON.stringify(value);
  return preview.length > 72 ? `${preview.slice(0, 69)}...` : preview;
}

function formatError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `操作失败：${message}`;
}
