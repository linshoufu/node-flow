import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, Save } from "lucide-react";
import { useWorkflowStore } from "@/store/workflow";
import { apiClient } from "@/api/client";
import { editedTemplateDraft, finishLibraryEdit, libraryChanged } from "@/lib/libraryEditing";
import { WorkflowConfigurationDialog } from "./WorkflowConfigurationDialog";
import { TextInput } from "./TextInput";
import { toast } from "./Toaster";

export function LibraryEditingToolbar() {
  const session = useWorkflowStore((state) => state.libraryEdit)!;
  const dirty = useWorkflowStore((state) => state.isDirty);
  const [name, setName] = useState(session.asset.name);
  const [description, setDescription] = useState(session.asset.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const changed = dirty || name !== session.asset.name || description !== (session.asset.description ?? "");
  useEffect(() => { const beforeUnload = (event: BeforeUnloadEvent) => { if (changed || busy) event.preventDefault(); }; window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload); }, [changed, busy]);
  return <><header className="mx-3 mt-3 flex shrink-0 flex-wrap items-center gap-3 rounded-2xl border border-primary/25 bg-surface px-4 py-3" aria-label="个人资源编辑">
    <button type="button" disabled={busy} onClick={() => changed ? setDiscard(true) : finishLibraryEdit()} className="flex items-center gap-1 text-xs text-muted hover:text-text"><ArrowLeft size={14} />返回工作流</button>
    <span className="text-xs font-semibold text-primary">编辑{session.asset.kind === "node" ? "预设" : session.asset.kind === "subflow" ? "循环体模板" : "工作流模板"}</span>
    <TextInput aria-label="资源名称" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} disabled={busy} className="w-56" />
    <TextInput aria-label="资源说明" value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} disabled={busy} placeholder="说明（可选）" className="w-56" />
    <span className="text-[11px] text-muted">{changed ? "草稿未保存" : "编辑独立副本"} · 此处不运行工作流</span><div className="flex-1" /><fieldset disabled={busy}><WorkflowConfigurationDialog /></fieldset>
    <button type="button" disabled={busy || !name.trim()} onClick={async () => { setBusy(true); useWorkflowStore.setState({ isSaving: true }); setError(""); try { await apiClient.updateNodeTemplate(session.asset.id, { ...editedTemplateDraft(), name: name.trim(), description }, session.asset.revision ?? 1); finishLibraryEdit(); libraryChanged(); toast("个人资源已保存", "success"); } catch (error) { setError(error instanceof Error ? error.message : "保存失败"); } finally { useWorkflowStore.setState({ isSaving: false }); setBusy(false); } }} className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs text-white disabled:opacity-40"><Save size={14} />{busy ? "正在保存…" : "保存到节点库"}</button>
    {error && <p role="alert" className="w-full text-xs text-danger">{error}</p>}
  </header><Dialog.Root open={discard} onOpenChange={setDiscard}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/65" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-96 max-w-[94vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 text-text"><Dialog.Title className="text-sm font-semibold">放弃资源草稿？</Dialog.Title><Dialog.Description className="mt-3 text-xs text-muted">未保存的修改会丢弃，返回之前的工作流草稿。</Dialog.Description><div className="mt-5 flex justify-end gap-3"><Dialog.Close className="text-xs text-muted">继续编辑</Dialog.Close><button type="button" onClick={finishLibraryEdit} className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">放弃修改并返回</button></div></Dialog.Content></Dialog.Portal></Dialog.Root></>;
}
