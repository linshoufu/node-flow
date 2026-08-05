import { useCallback } from "react";
import { formatApiError } from "../lib/apiError";
import type { WorkflowDocument } from "../types";
import type { WorkflowMutationResult } from "./useWorkflowMutationController";

type VersionMutation = (
  workflowId: string,
  version: number,
  expectedVersion?: number,
) => Promise<WorkflowMutationResult<WorkflowDocument>>;

type UseWorkflowVersionActionsOptions = {
  clearVersionDiff: () => void;
  compareVersion: (version: number) => Promise<unknown>;
  currentWorkflow: WorkflowDocument;
  isEditorLocked: boolean;
  isRollingBack: boolean;
  isWorkflowCurrent: (workflowId: string) => boolean;
  isWorkflowDirty: boolean;
  onConflict: (action: "restore" | "rollback", error: unknown) => boolean;
  onMessage: (message: string) => void;
  refreshVersions: () => Promise<unknown>;
  replaceWorkflow: (workflow: WorkflowDocument, options: { baseline: "clean" }) => void;
  restoreVersion: VersionMutation;
  rollbackVersion: VersionMutation;
  selectedWorkflowId: string;
  selectWorkflow: (workflowId: string) => Promise<unknown>;
  setRollbackTargetVersion: (version: number | null) => void;
  toggleTriggersPanel: () => void;
  toggleVersionsPanel: () => void;
  upsertWorkflowSummary: (workflow: WorkflowDocument) => void;
};

export function useWorkflowVersionActions({
  clearVersionDiff,
  compareVersion,
  currentWorkflow,
  isEditorLocked,
  isRollingBack,
  isWorkflowCurrent,
  isWorkflowDirty,
  onConflict,
  onMessage,
  refreshVersions,
  replaceWorkflow,
  restoreVersion,
  rollbackVersion,
  selectedWorkflowId,
  selectWorkflow,
  setRollbackTargetVersion,
  toggleTriggersPanel,
  toggleVersionsPanel,
  upsertWorkflowSummary,
}: UseWorkflowVersionActionsOptions) {
  const toggleWorkflowVersions = useCallback(() => {
    if (!selectedWorkflowId) {
      onMessage("请先保存工作流，再查看版本历史。");
      return;
    }
    toggleVersionsPanel();
  }, [onMessage, selectedWorkflowId, toggleVersionsPanel]);

  const toggleWorkflowTriggers = useCallback(() => {
    if (!selectedWorkflowId) {
      onMessage("请先保存工作流，再查看触发器状态。");
      return;
    }
    if (isWorkflowDirty) {
      onMessage("当前工作流有未保存变更，请先保存后再查看触发器状态。");
      return;
    }
    toggleTriggersPanel();
  }, [isWorkflowDirty, onMessage, selectedWorkflowId, toggleTriggersPanel]);

  const restoreWorkflowVersion = useCallback(async (version: number) => {
    if (!selectedWorkflowId || isEditorLocked || isWorkflowDirty) {
      return;
    }

    const result = await restoreVersion(selectedWorkflowId, version, currentWorkflow.version);
    if (result.kind === "busy") {
      onMessage("已有工作流变更正在处理，请稍候。");
      return;
    }
    if (result.kind === "stale") {
      return;
    }
    if (result.kind === "error") {
      if (!onConflict("restore", result.error)) {
        onMessage(`恢复工作流版本失败：${formatApiError(result.error)}`);
      }
      return;
    }

    const restored = result.value;
    replaceWorkflow(restored, { baseline: "clean" });
    clearVersionDiff();
    setRollbackTargetVersion(null);
    upsertWorkflowSummary(restored);
    await selectWorkflow(restored.id);
    if (!isWorkflowCurrent(restored.id)) {
      return;
    }
    onMessage(`已恢复 v${version}，并保存为草稿 v${restored.version}。`);
    await refreshVersions();
  }, [
    clearVersionDiff,
    currentWorkflow.version,
    isEditorLocked,
    isWorkflowCurrent,
    isWorkflowDirty,
    onConflict,
    onMessage,
    refreshVersions,
    replaceWorkflow,
    restoreVersion,
    selectedWorkflowId,
    selectWorkflow,
    setRollbackTargetVersion,
    upsertWorkflowSummary,
  ]);

  const rollbackWorkflowVersion = useCallback(async (version: number) => {
    if (!selectedWorkflowId || isEditorLocked || isWorkflowDirty || isRollingBack) {
      return;
    }

    const result = await rollbackVersion(selectedWorkflowId, version, currentWorkflow.version);
    if (result.kind === "busy") {
      onMessage("已有工作流变更正在处理，请稍候。");
      return;
    }
    if (result.kind === "stale") {
      return;
    }
    if (result.kind === "error") {
      if (!onConflict("rollback", result.error)) {
        onMessage(`生产版本回滚失败：${formatApiError(result.error)}`);
      }
      return;
    }

    const rolledBack = result.value;
    replaceWorkflow(rolledBack, { baseline: "clean" });
    clearVersionDiff();
    setRollbackTargetVersion(null);
    upsertWorkflowSummary(rolledBack);
    await selectWorkflow(rolledBack.id);
    if (!isWorkflowCurrent(rolledBack.id)) {
      return;
    }
    onMessage(`已将生产版本回滚到 v${version}，并创建 v${rolledBack.version}。`);
    await refreshVersions();
  }, [
    clearVersionDiff,
    currentWorkflow.version,
    isEditorLocked,
    isRollingBack,
    isWorkflowCurrent,
    isWorkflowDirty,
    onConflict,
    onMessage,
    refreshVersions,
    replaceWorkflow,
    rollbackVersion,
    selectedWorkflowId,
    selectWorkflow,
    setRollbackTargetVersion,
    upsertWorkflowSummary,
  ]);

  const compareWorkflowVersion = useCallback(async (version: number) => {
    if (
      !selectedWorkflowId
      || isWorkflowDirty
      || isEditorLocked
      || version === currentWorkflow.version
    ) {
      return;
    }
    await compareVersion(version);
  }, [compareVersion, currentWorkflow.version, isEditorLocked, isWorkflowDirty, selectedWorkflowId]);

  return {
    compareWorkflowVersion,
    restoreWorkflowVersion,
    rollbackWorkflowVersion,
    toggleWorkflowTriggers,
    toggleWorkflowVersions,
  };
}
