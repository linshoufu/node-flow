import { useEffect, useState } from "react";
import type { ProjectEnvironment } from "../types";

type ManualRunDialogProps = {
  open: boolean;
  disabled?: boolean;
  environments?: ProjectEnvironment[];
  defaultEnvironmentId?: string;
  onClose: () => void;
  onRun: (input: unknown, environmentId: string) => void;
};

export function ManualRunDialog({
  open,
  disabled = false,
  environments = [],
  defaultEnvironmentId = "default",
  onClose,
  onRun,
}: ManualRunDialogProps) {
  const [inputText, setInputText] = useState("{}");
  const [environmentId, setEnvironmentId] = useState(defaultEnvironmentId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setInputText("{}");
      setEnvironmentId(defaultEnvironmentId);
      setError(null);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  function submit() {
    try {
      onRun(JSON.parse(inputText), environmentId);
    } catch {
      setError("运行输入不是有效的 JSON。");
    }
  }

  return (
    <div className="manual-run-dialog-backdrop" role="presentation">
      <section aria-label="本次运行输入" aria-modal="true" className="manual-run-dialog" role="dialog">
        <div className="manual-run-dialog-header">
          <div>
            <h2>本次运行输入</h2>
            <p>JSON</p>
          </div>
          <button aria-label="关闭运行输入" disabled={disabled} type="button" onClick={onClose}>
            关闭
          </button>
        </div>
        <label className="manual-run-input-field">
          <span>运行输入 JSON</span>
          <textarea
            aria-describedby={error ? "manual-run-input-error" : undefined}
            aria-invalid={error ? "true" : undefined}
            aria-label="运行输入 JSON"
            disabled={disabled}
            spellCheck={false}
            value={inputText}
            onChange={(event) => {
              setInputText(event.currentTarget.value);
              setError(null);
            }}
          />
        </label>
        <label className="manual-run-input-field">
          <span>运行环境</span>
          <select aria-label="本次运行环境" disabled={disabled || environments.length === 0} value={environmentId} onChange={(event) => setEnvironmentId(event.currentTarget.value)}>
            {environments.map((environment) => (
              <option key={environment.id} value={environment.id}>{environment.name}</option>
            ))}
          </select>
        </label>
        {error ? (
          <p className="manual-run-input-error" id="manual-run-input-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="manual-run-dialog-actions">
          <button disabled={disabled} type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button" disabled={disabled} type="button" onClick={submit}>
            带输入运行
          </button>
        </div>
      </section>
    </div>
  );
}
