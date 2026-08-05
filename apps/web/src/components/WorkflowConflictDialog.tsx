import { Copy, RefreshCw, X } from "lucide-react";
import type { WorkflowConflictAction } from "../hooks/useWorkflowConflictController";
import { DialogBackdrop } from "./DialogBackdrop";

type WorkflowConflictDialogProps = {
  action: WorkflowConflictAction;
  busy: boolean;
  currentVersion: number | null;
  expectedVersion: number | null;
  onClose: () => void;
  onReload: () => void;
  onSaveCopy?: () => void;
};

export function WorkflowConflictDialog({
  action,
  busy,
  currentVersion,
  expectedVersion,
  onClose,
  onReload,
  onSaveCopy,
}: WorkflowConflictDialogProps) {
  return (
    <DialogBackdrop onClose={busy ? () => undefined : onClose}>
      <section
        aria-label="处理工作流版本冲突"
        aria-modal="true"
        className="workflow-conflict-dialog"
        role="dialog"
      >
        <header>
          <div>
            <span className="workflow-conflict-eyebrow">版本冲突</span>
            <h2>工作流已在其他位置更新</h2>
          </div>
          <button
            aria-label="稍后处理版本冲突"
            className="icon-button"
            disabled={busy}
            title="稍后处理"
            type="button"
            onClick={onClose}
          >
            <X aria-hidden="true" size={18} strokeWidth={2} />
          </button>
        </header>
        <div className="workflow-conflict-body">
          <p>{conflictMessage(action)}</p>
          {expectedVersion !== null || currentVersion !== null ? (
            <dl>
              <div>
                <dt>当前页面</dt>
                <dd>{expectedVersion === null ? "未知版本" : `v${expectedVersion}`}</dd>
              </div>
              <div>
                <dt>服务器</dt>
                <dd>{currentVersion === null ? "新版本" : `v${currentVersion}`}</dd>
              </div>
            </dl>
          ) : null}
          <p className="workflow-conflict-note">
            {onSaveCopy
              ? "重新加载会使用服务器版本；另存为副本会保留当前画布，并创建一个新的草稿工作流。"
              : "重新加载后可以基于服务器上的最新版本继续操作。"}
          </p>
        </div>
        <footer>
          <button disabled={busy} type="button" onClick={onClose}>稍后处理</button>
          {onSaveCopy ? (
            <button disabled={busy} type="button" onClick={onSaveCopy}>
              <Copy aria-hidden="true" size={16} strokeWidth={2} />
              另存为副本
            </button>
          ) : null}
          <button className="primary-button" disabled={busy} type="button" onClick={onReload}>
            <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
            重新加载
          </button>
        </footer>
      </section>
    </DialogBackdrop>
  );
}

function conflictMessage(action: WorkflowConflictAction): string {
  switch (action) {
    case "activation":
      return "发布状态变更未执行，服务器上的工作流已不是当前页面所基于的版本。";
    case "apply_upgrades":
      return "节点升级未应用，服务器上的工作流已发生变化。";
    case "restore":
      return "历史版本未恢复，服务器上的工作流已发生变化。";
    case "rollback":
      return "生产版本未回滚，服务器上的工作流已发生变化。";
    default:
      return "保存未执行。当前页面的修改仍然保留，没有覆盖服务器上的新版本。";
  }
}
