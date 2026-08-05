import { useCallback, useEffect, useRef } from "react";
import type { ApiClient } from "../api/client";
import { apiClient } from "../api/client";
import { formatApiError } from "../lib/apiError";
import { duplicateWorkflowDraft, normalizeWorkflowDocument } from "../lib/workflow";
import type { WorkflowDocument } from "../types";
import type { WorkflowConflict } from "./useWorkflowConflictController";
import type {
  WorkflowMutationResult,
  WorkflowSaveMode,
} from "./useWorkflowMutationController";

type WorkflowConflictRecoveryClient = Pick<ApiClient, "getWorkflow">;

type UseWorkflowConflictRecoveryActionsOptions = {
  clearConflict: () => void;
  client?: WorkflowConflictRecoveryClient;
  commitWorkflowSave: (
    workflow: WorkflowDocument,
    expectedVersion: number | undefined,
    mode: WorkflowSaveMode,
    ownerDocumentId?: string,
  ) => Promise<WorkflowMutationResult<WorkflowDocument>>;
  conflict: WorkflowConflict | null;
  currentWorkflow: WorkflowDocument;
  isPageBusy: boolean;
  isWorkflowMutating: boolean;
  navigate: (route: { kind: "workflow"; workflowId: string }) => void;
  onBusyChange: (busy: boolean) => void;
  onClearIssues: () => void;
  onMessage: (message: string) => void;
  onResetAutoSave: () => void;
  onResetEditor: () => void;
  replaceWorkflow: (
    workflow: WorkflowDocument,
    options: { baseline: "clean" },
  ) => void;
  selectedWorkflowId: string;
  selectWorkflow: (workflowId: string) => Promise<unknown>;
  upsertWorkflowSummary: (workflow: WorkflowDocument) => void;
};

export function useWorkflowConflictRecoveryActions({
  clearConflict,
  client = apiClient,
  commitWorkflowSave,
  conflict,
  currentWorkflow,
  isPageBusy,
  isWorkflowMutating,
  navigate,
  onBusyChange,
  onClearIssues,
  onMessage,
  onResetAutoSave,
  onResetEditor,
  replaceWorkflow,
  selectedWorkflowId,
  selectWorkflow,
  upsertWorkflowSummary,
}: UseWorkflowConflictRecoveryActionsOptions) {
  const mountedRef = useRef(true);
  const documentIdRef = useRef(currentWorkflow.id);
  const activeRequestRef = useRef<number | null>(null);
  const requestSequenceRef = useRef(0);
  documentIdRef.current = currentWorkflow.id;

  useEffect(() => () => {
    mountedRef.current = false;
    activeRequestRef.current = null;
  }, []);

  const beginRequest = useCallback(() => {
    if (activeRequestRef.current !== null || isPageBusy || isWorkflowMutating) {
      return null;
    }
    const requestId = ++requestSequenceRef.current;
    activeRequestRef.current = requestId;
    onBusyChange(true);
    return requestId;
  }, [isPageBusy, isWorkflowMutating, onBusyChange]);

  const isRequestCurrent = useCallback((requestId: number, ownerDocumentId: string) =>
    mountedRef.current
    && activeRequestRef.current === requestId
    && documentIdRef.current === ownerDocumentId, []);

  const finishRequest = useCallback((requestId: number) => {
    if (activeRequestRef.current !== requestId) {
      return;
    }
    activeRequestRef.current = null;
    if (mountedRef.current) {
      onBusyChange(false);
    }
  }, [onBusyChange]);

  const reloadWorkflowAfterConflict = useCallback(async () => {
    const workflowId = selectedWorkflowId || currentWorkflow.id;
    if (!workflowId) {
      return;
    }
    const requestId = beginRequest();
    if (requestId === null) {
      return;
    }
    const ownerDocumentId = currentWorkflow.id;

    try {
      const loaded = normalizeWorkflowDocument(await client.getWorkflow(workflowId));
      if (!isRequestCurrent(requestId, ownerDocumentId)) {
        return;
      }
      replaceWorkflow(loaded, { baseline: "clean" });
      await selectWorkflow(loaded.id);
      upsertWorkflowSummary(loaded);
      onResetEditor();
      onClearIssues();
      clearConflict();
      onResetAutoSave();
      onMessage(`已重新加载服务器版本 v${loaded.version}。`);
    } catch (error) {
      if (isRequestCurrent(requestId, ownerDocumentId)) {
        onMessage(`重新加载工作流失败：${formatApiError(error)}`);
      }
    } finally {
      finishRequest(requestId);
    }
  }, [
    beginRequest,
    clearConflict,
    client,
    currentWorkflow.id,
    finishRequest,
    isRequestCurrent,
    onClearIssues,
    onMessage,
    onResetAutoSave,
    onResetEditor,
    replaceWorkflow,
    selectedWorkflowId,
    selectWorkflow,
    upsertWorkflowSummary,
  ]);

  const saveWorkflowConflictAsCopy = useCallback(async () => {
    if (conflict?.action !== "save") {
      return;
    }
    const requestId = beginRequest();
    if (requestId === null) {
      return;
    }
    const ownerDocumentId = currentWorkflow.id;
    const draft = normalizeWorkflowDocument(duplicateWorkflowDraft(currentWorkflow));

    try {
      const result = await commitWorkflowSave(draft, undefined, "manual", ownerDocumentId);
      if (!isRequestCurrent(requestId, ownerDocumentId)) {
        return;
      }
      if (result.kind !== "success") {
        if (result.kind === "error") {
          onMessage(`另存为副本失败：${formatApiError(result.error)}`);
        }
        return;
      }

      const saved = result.value;
      replaceWorkflow(saved, { baseline: "clean" });
      await selectWorkflow(saved.id);
      upsertWorkflowSummary(saved);
      navigate({ kind: "workflow", workflowId: saved.id });
      onResetEditor();
      onClearIssues();
      clearConflict();
      onResetAutoSave();
      onMessage(`已保留当前修改，并另存为“${saved.name}” v${saved.version}。`);
    } finally {
      finishRequest(requestId);
    }
  }, [
    beginRequest,
    clearConflict,
    commitWorkflowSave,
    conflict,
    currentWorkflow,
    finishRequest,
    isRequestCurrent,
    navigate,
    onClearIssues,
    onMessage,
    onResetAutoSave,
    onResetEditor,
    replaceWorkflow,
    selectWorkflow,
    upsertWorkflowSummary,
  ]);

  return {
    reloadWorkflowAfterConflict,
    saveWorkflowConflictAsCopy,
  };
}
