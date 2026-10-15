import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { BookmarkPlus, X } from "lucide-react";
import { getActiveGraph, useWorkflowStore } from "@/store/workflow";
import { apiClient } from "@/api/client";
import { templateDraft } from "@/lib/templateLibrary";
import type { NodeTemplate } from "@/types";
import type { RunParameter } from "@/lib/runParameters";
import type { CanvasScopeSegment } from "@/store/workflow";
import { libraryChanged } from "@/lib/libraryEditing";
import { TextInput } from "./TextInput";

export function SaveLibraryAsset({ preset, onSaved, templateKind, scopeOverride, configurationOverride, disabled = false }: { preset: boolean; onSaved?: () => void; templateKind?: NodeTemplate["kind"]; scopeOverride?: CanvasScopeSegment[]; configurationOverride?: RunParameter[]; disabled?: boolean }) {
  const workflow = useWorkflowStore((state) => state.workflow);
  const scope = useWorkflowStore((state) => state.canvasScope);
  const selected = useWorkflowStore((state) => state.selectedNodeId);
  const editing = useWorkflowStore((state) => !!state.libraryEdit);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const kind = templateKind ?? (preset ? "node" : scope.length ? "subflow" : "workflow");
  const targetScope = kind === "workflow" ? [] : scopeOverride ?? scope;
  const document = configurationOverride ? { ...workflow, settings: { timeout_seconds: 600, ...workflow.settings, configuration: configurationOverride } } : workflow;
  const snapshot = () => templateDraft(document, targetScope, selected, kind);
  const action = preset ? "保存选中节点为预设" : kind === "subflow" ? "保存当前循环体为模板" : "保存当前工作流为模板";
  const unavailable = disabled || (preset ? !selected : !getActiveGraph(workflow, targetScope).nodes.length);
  const begin = () => { try { const draft = snapshot(); setName(draft.name || (kind === "subflow" ? targetScope.at(-1)?.label : "") || ""); setDescription(""); setError(""); setOpen(true); } catch (error) { setError(String(error)); } };
  if (editing) return null;
  return <><button type="button" disabled={unavailable} title={unavailable ? preset ? "请先选中一个节点" : "请先添加节点" : action} onClick={begin} className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/25 bg-primary/5 px-2 py-2 text-[11px] text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"><BookmarkPlus size={13} />{action}</button><Dialog.Root open={open} onOpenChange={(value) => { if (!saving) setOpen(value); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/65" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[440px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface text-text shadow-2xl"><form onSubmit={async (event) => { event.preventDefault(); setSaving(true); setError(""); try { await apiClient.createNodeTemplate({ ...snapshot(), name: name.trim(), description }); onSaved?.(); libraryChanged(); setOpen(false); } catch (error) { setError(error instanceof Error ? error.message : "保存失败"); } finally { setSaving(false); } }}><header className="flex items-start gap-3 border-b border-border p-4"><div className="flex-1"><Dialog.Title className="text-sm font-semibold">{action}</Dialog.Title><Dialog.Description className="mt-2 text-xs leading-relaxed text-muted">保存到“我的{preset ? "预设" : "模板"}”，添加时创建独立副本。保留配置引用，排除运行数据；工作流模板默认预演。</Dialog.Description></div><Dialog.Close disabled={saving} aria-label="关闭保存对话框"><X size={16} /></Dialog.Close></header><div className="space-y-4 p-4"><label className="block text-xs text-text-secondary">名称<TextInput autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full" /></label><label className="block text-xs text-text-secondary">说明（可选）<textarea maxLength={1000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 w-full rounded-lg border border-border bg-raised p-2 text-xs outline-none focus:border-primary" /></label><p className="text-[11px] leading-relaxed text-muted">配置档和凭据只保留引用，不复制账号密码。引用运行参数的预设，需要目标工作流已有同名、同类型参数。</p>{error && <p role="alert" className="text-xs text-danger">{error}</p>}</div><footer className="flex justify-end gap-3 border-t border-border p-4"><Dialog.Close disabled={saving} type="button" className="text-xs text-muted">取消</Dialog.Close><button type="submit" disabled={saving || !name.trim()} className="rounded-lg bg-primary px-4 py-2 text-xs text-white disabled:opacity-40">{saving ? "正在保存…" : "保存到节点库"}</button></footer></form></Dialog.Content></Dialog.Portal></Dialog.Root>{error && !open && <p role="alert" className="text-xs text-danger">{error}</p>}</>;
}
