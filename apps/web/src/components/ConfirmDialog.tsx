import { DialogBackdrop } from "./DialogBackdrop";

type ConfirmDialogProps = {
  // 确认执行期间置 true：禁用全部按钮并屏蔽 Escape/遮罩关闭，防止连点与竞态
  busy?: boolean;
  cancelLabel?: string;
  confirmLabel: string;
  // 破坏性操作的确认按钮使用 danger 样式
  danger?: boolean;
  description?: string;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
};

// 统一确认弹窗：替换原生 window.confirm，复用 DialogBackdrop 的焦点陷阱/Escape/滚动锁定
export function ConfirmDialog({
  busy = false,
  cancelLabel = "取消",
  confirmLabel,
  danger = false,
  description,
  title,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <DialogBackdrop onClose={busy ? () => undefined : onCancel}>
      <section
        aria-label={title}
        aria-modal="true"
        className="confirm-dialog"
        role="dialog"
      >
        <header>
          <h2>{title}</h2>
        </header>
        {description ? (
          <div className="confirm-dialog-body">
            <p>{description}</p>
          </div>
        ) : null}
        <footer>
          <button disabled={busy} type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={danger ? "danger-button" : "primary-button"}
            disabled={busy}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </section>
    </DialogBackdrop>
  );
}
