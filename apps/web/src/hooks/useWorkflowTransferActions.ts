import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { ApiClient } from "../api/client";
import { apiClient } from "../api/client";
import { formatApiError } from "../lib/apiError";
import { duplicateWorkflowDraft, normalizeWorkflowDocument } from "../lib/workflow";
import {
  parseImportedWorkflow,
  serializeWorkflowExport,
  workflowExportFilename,
} from "../lib/workflowTransfer";
import type { WorkflowDocument } from "../types";

export type WorkflowTransferClient = Pick<ApiClient, "getWorkflow">;
export type WorkflowDownload = (content: string, filename: string) => void;

type UseWorkflowTransferActionsOptions = {
  blocked: boolean;
  client?: WorkflowTransferClient;
  confirmDiscardUnsavedChanges: () => Promise<boolean>;
  currentWorkflow: WorkflowDocument;
  documentId: string;
  download?: WorkflowDownload;
  navigateToNew: () => void;
  onBusyChange: (busy: boolean) => void;
  onMessage: (message: string) => void;
  onOpenDraft: (workflow: WorkflowDocument, message: string) => void;
};

type ActiveTransfer = {
  documentId: string;
  token: number;
};

export function useWorkflowTransferActions({
  blocked,
  client = apiClient,
  confirmDiscardUnsavedChanges,
  currentWorkflow,
  documentId,
  download = downloadWorkflowFile,
  navigateToNew,
  onBusyChange,
  onMessage,
  onOpenDraft,
}: UseWorkflowTransferActionsOptions) {
  const mountedRef = useRef(true);
  const documentIdRef = useRef(documentId);
  const activeTransferRef = useRef<ActiveTransfer | null>(null);
  const transferTokenRef = useRef(0);
  // 异步确认弹窗打开期间阻止重复触发确认，与同步传输租约叠加防连点
  const confirmPendingRef = useRef(false);
  documentIdRef.current = documentId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      transferTokenRef.current += 1;
      activeTransferRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const activeTransfer = activeTransferRef.current;
    transferTokenRef.current += 1;
    activeTransferRef.current = null;
    if (activeTransfer && mountedRef.current) {
      onBusyChange(false);
    }
  }, [documentId, onBusyChange]);

  const beginTransfer = useCallback((): ActiveTransfer | null => {
    if (blocked || activeTransferRef.current !== null) {
      return null;
    }
    const transfer = {
      documentId: documentIdRef.current,
      token: ++transferTokenRef.current,
    };
    activeTransferRef.current = transfer;
    onBusyChange(true);
    return transfer;
  }, [blocked, onBusyChange]);

  const isTransferCurrent = useCallback((transfer: ActiveTransfer) =>
    mountedRef.current
    && documentIdRef.current === transfer.documentId
    && activeTransferRef.current?.token === transfer.token, []);

  const finishTransfer = useCallback((transfer: ActiveTransfer) => {
    if (activeTransferRef.current?.token !== transfer.token) {
      return;
    }
    activeTransferRef.current = null;
    if (mountedRef.current) {
      onBusyChange(false);
    }
  }, [onBusyChange]);

  const duplicateWorkflow = useCallback(async (workflowId: string) => {
    if (blocked || activeTransferRef.current !== null || confirmPendingRef.current) {
      return null;
    }
    // 同步记录发起确认的文档：异步确认期间若切换文档，确认后丢弃结果
    const initiatedDocumentId = documentIdRef.current;
    confirmPendingRef.current = true;
    let confirmed = false;
    try {
      confirmed = await confirmDiscardUnsavedChanges();
    } finally {
      confirmPendingRef.current = false;
    }
    if (!confirmed || documentIdRef.current !== initiatedDocumentId) {
      return null;
    }
    const transfer = beginTransfer();
    if (!transfer) {
      return null;
    }

    try {
      const loaded = normalizeWorkflowDocument(await client.getWorkflow(workflowId));
      if (!isTransferCurrent(transfer)) {
        return null;
      }
      const draft = duplicateWorkflowDraft(loaded);
      onOpenDraft(draft, `已复制 ${loaded.name}，保存后会成为新的工作流。`);
      navigateToNew();
      return draft;
    } catch (error) {
      if (isTransferCurrent(transfer)) {
        onMessage(`复制工作流失败：${formatApiError(error)}`);
      }
      return null;
    } finally {
      finishTransfer(transfer);
    }
  }, [
    beginTransfer,
    blocked,
    client,
    confirmDiscardUnsavedChanges,
    finishTransfer,
    isTransferCurrent,
    navigateToNew,
    onMessage,
    onOpenDraft,
  ]);

  const importWorkflow = useCallback(async (file: File) => {
    if (blocked || activeTransferRef.current !== null || confirmPendingRef.current) {
      return null;
    }
    // 同步记录发起确认的文档：异步确认期间若切换文档，确认后丢弃结果
    const initiatedDocumentId = documentIdRef.current;
    confirmPendingRef.current = true;
    let confirmed = false;
    try {
      confirmed = await confirmDiscardUnsavedChanges();
    } finally {
      confirmPendingRef.current = false;
    }
    if (!confirmed || documentIdRef.current !== initiatedDocumentId) {
      return null;
    }
    const transfer = beginTransfer();
    if (!transfer) {
      return null;
    }

    try {
      const serialized = await file.text();
      if (!isTransferCurrent(transfer)) {
        return null;
      }
      const imported = parseImportedWorkflow(serialized);
      onOpenDraft(imported, `已导入 ${imported.name}，请验证并保存为新的工作流。`);
      navigateToNew();
      return imported;
    } catch (error) {
      if (isTransferCurrent(transfer)) {
        onMessage(`导入工作流失败：${formatApiError(error)}`);
      }
      return null;
    } finally {
      finishTransfer(transfer);
    }
  }, [
    beginTransfer,
    blocked,
    confirmDiscardUnsavedChanges,
    finishTransfer,
    isTransferCurrent,
    navigateToNew,
    onMessage,
    onOpenDraft,
  ]);

  const exportWorkflow = useCallback(() => {
    try {
      download(
        serializeWorkflowExport(currentWorkflow),
        workflowExportFilename(currentWorkflow),
      );
      onMessage(`已导出 ${currentWorkflow.name || "未命名工作流"}。`);
      return true;
    } catch (error) {
      onMessage(`导出工作流失败：${formatApiError(error)}`);
      return false;
    }
  }, [currentWorkflow, download, onMessage]);

  return {
    duplicateWorkflow,
    exportWorkflow,
    importWorkflow,
  };
}

function downloadWorkflowFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
