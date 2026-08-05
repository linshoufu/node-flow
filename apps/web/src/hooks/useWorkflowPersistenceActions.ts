import { useCallback } from "react";
import { formatApiError } from "../lib/apiError";
import { isSettingsPreRunIssue, type PreRunIssue } from "../lib/preRunChecks";
import { normalizeWorkflowDocument } from "../lib/workflow";
import type { WorkflowDocument } from "../types";
import type { WorkflowAutoSaveResult } from "./useWorkflowAutoSaveController";
import type {
  WorkflowMutationResult,
  WorkflowSaveMode,
} from "./useWorkflowMutationController";

export type PersistWorkflowResult =
  | { kind: "success"; pendingChanges: boolean; workflow: WorkflowDocument }
  | { kind: "busy" | "invalid" | "stale" }
  | { kind: "conflict" | "error"; error: unknown };

type UseWorkflowPersistenceActionsOptions = {
  acceptSavedWorkflow: (
    workflow: WorkflowDocument,
    options: { requestRevision: number },
  ) => { preservedNewerChanges: boolean };
  commitWorkflowSave: (
    workflow: WorkflowDocument,
    expectedVersion: number | undefined,
    mode: WorkflowSaveMode,
  ) => Promise<WorkflowMutationResult<WorkflowDocument>>;
  currentPreRunIssues: PreRunIssue[];
  isWorkflowDirty: boolean;
  onClearIssues: () => void;
  onConflict: (action: "save", error: unknown) => boolean;
  onMessage: (message: string) => void;
  onNavigateToWorkflow: (workflowId: string) => void;
  onShowSettingsIssues: () => void;
  selectedWorkflowId: string;
  selectWorkflow: (workflowId: string) => Promise<unknown>;
  upsertWorkflowSummary: (workflow: WorkflowDocument) => void;
  workflow: WorkflowDocument;
  workflowRevision: number;
};

export function useWorkflowPersistenceActions({
  acceptSavedWorkflow,
  commitWorkflowSave,
  currentPreRunIssues,
  isWorkflowDirty,
  onClearIssues,
  onConflict,
  onMessage,
  onNavigateToWorkflow,
  onShowSettingsIssues,
  selectedWorkflowId,
  selectWorkflow,
  upsertWorkflowSummary,
  workflow,
  workflowRevision,
}: UseWorkflowPersistenceActionsOptions) {
  const persistWorkflow = useCallback(async (
    mode: WorkflowSaveMode,
  ): Promise<PersistWorkflowResult> => {
    const settingsIssues = currentPreRunIssues.filter(isSettingsPreRunIssue);
    if (settingsIssues.length > 0) {
      if (mode === "manual") {
        onShowSettingsIssues();
        onMessage(`保存前检查发现 ${settingsIssues.length} 个问题，请先补齐配置。`);
      }
      return { kind: "invalid" };
    }

    if (!isWorkflowDirty && selectedWorkflowId) {
      if (mode === "manual") {
        onMessage("没有需要保存的修改。");
      }
      return { kind: "success", pendingChanges: false, workflow };
    }

    const isFirstSave = !selectedWorkflowId;
    const requestRevision = workflowRevision;
    const workflowToSave = normalizeWorkflowDocument(workflow);
    const result = await commitWorkflowSave(
      workflowToSave,
      selectedWorkflowId ? workflow.version : undefined,
      mode,
    );

    if (result.kind === "busy") {
      if (mode === "manual") {
        onMessage("已有工作流变更正在处理，请稍候。");
      }
      return { kind: "busy" };
    }
    if (result.kind === "stale") {
      return { kind: "stale" };
    }
    if (result.kind === "error") {
      if (onConflict("save", result.error)) {
        return { kind: "conflict", error: result.error };
      }
      if (mode === "manual") {
        onMessage(`保存失败：${formatApiError(result.error)}`);
      }
      return { kind: "error", error: result.error };
    }

    const savedWorkflow = result.value;
    const acceptance = acceptSavedWorkflow(savedWorkflow, { requestRevision });
    await selectWorkflow(savedWorkflow.id);
    upsertWorkflowSummary(savedWorkflow);
    if (isFirstSave) {
      onNavigateToWorkflow(savedWorkflow.id);
    }
    if (!acceptance.preservedNewerChanges) {
      onClearIssues();
    }
    if (mode === "manual") {
      onMessage(
        acceptance.preservedNewerChanges
          ? `已保存 v${savedWorkflow.version}，保存期间的新修改仍在等待保存。`
          : `已保存 v${savedWorkflow.version}。`,
      );
    }
    return {
      kind: "success",
      pendingChanges: acceptance.preservedNewerChanges,
      workflow: savedWorkflow,
    };
  }, [
    acceptSavedWorkflow,
    commitWorkflowSave,
    currentPreRunIssues,
    isWorkflowDirty,
    onClearIssues,
    onConflict,
    onMessage,
    onNavigateToWorkflow,
    onShowSettingsIssues,
    selectedWorkflowId,
    selectWorkflow,
    upsertWorkflowSummary,
    workflow,
    workflowRevision,
  ]);

  const saveWorkflow = useCallback(async () => {
    const result = await persistWorkflow("manual");
    return result.kind === "success" ? result.workflow : null;
  }, [persistWorkflow]);

  const saveWorkflowAutomatically = useCallback(async (): Promise<WorkflowAutoSaveResult> => {
    const result = await persistWorkflow("auto");
    if (result.kind === "success") {
      return { kind: "success", pendingChanges: result.pendingChanges };
    }
    return result;
  }, [persistWorkflow]);

  return {
    persistWorkflow,
    saveWorkflow,
    saveWorkflowAutomatically,
  };
}
