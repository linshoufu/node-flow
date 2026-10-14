import { CircleAlert, Copy, RotateCcw, X } from "lucide-react";
import type { SaveFailure } from "@/lib/saveFailure";
import { useWorkflowStore } from "@/store/workflow";

const actionClass = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] text-text-secondary transition hover:bg-raised hover:text-text";

export type SaveFailureNoticeViewProps = {
  failure: SaveFailure;
  onRetrySave: () => void;
  onReloadFromServer: () => void;
  onSaveAsCopy: () => void;
  onDismiss: () => void;
};

/** 纯展示：保存失败的原因和可执行操作。 */
export function SaveFailureNoticeView({ failure, onRetrySave, onReloadFromServer, onSaveAsCopy, onDismiss }: SaveFailureNoticeViewProps) {
  const conflict = failure.kind === "conflict";
  const detail = conflict && failure.currentVersion !== undefined
    ? `${failure.message}（服务器当前版本 v${failure.currentVersion}）`
    : failure.message;

  return <section role="alert" aria-live="polite" aria-label="保存失败" className="mx-3 mt-2 flex shrink-0 items-center gap-3 rounded-2xl border border-danger/35 bg-danger/8 px-4 py-2.5">
    <CircleAlert size={15} className="shrink-0 text-danger" />
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs font-medium text-danger">{conflict ? "保存失败：版本冲突" : "保存失败"}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted" title={detail}>{detail}</p>
    </div>
    {conflict ? <>
      <button type="button" className={actionClass} onClick={onReloadFromServer}>
        <RotateCcw size={12} />重新加载服务器版本
      </button>
      <button type="button" className={actionClass} onClick={onSaveAsCopy}>
        <Copy size={12} />另存为副本
      </button>
    </> : <button type="button" className={actionClass} onClick={onRetrySave}>
      <RotateCcw size={12} />重试保存
    </button>}
    <button type="button" onClick={onDismiss} aria-label="关闭保存失败提示" title="关闭" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted transition hover:bg-raised hover:text-text">
      <X size={14} />
    </button>
  </section>;
}

/** 保存失败时在顶部持续显示原因和可执行操作，避免失败被静默吞掉。 */
export function SaveFailureNotice() {
  const failure = useWorkflowStore((s) => s.saveError);
  const saveWorkflow = useWorkflowStore((s) => s.saveWorkflow);
  const reloadFromServer = useWorkflowStore((s) => s.reloadFromServer);
  const saveAsCopy = useWorkflowStore((s) => s.saveAsCopy);
  const clearSaveError = useWorkflowStore((s) => s.clearSaveError);
  if (!failure) return null;

  return <SaveFailureNoticeView
    failure={failure}
    onRetrySave={() => void saveWorkflow()}
    onReloadFromServer={() => { if (confirm("放弃当前未保存的修改，加载服务器上的最新版本？")) void reloadFromServer(); }}
    onSaveAsCopy={() => void saveAsCopy()}
    onDismiss={clearSaveError}
  />;
}
