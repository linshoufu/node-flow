import { useCallback } from "react";
import { formatApiError } from "../lib/apiError";
import type {
  WorkflowDocument,
  WorkflowPublicationStatus,
  WorkflowUpgradePreview,
} from "../types";
import type { WorkflowMutationResult } from "./useWorkflowMutationController";

type UseWorkflowReleaseActionsOptions = {
  acceptSavedWorkflow: (workflow: WorkflowDocument) => void;
  applyNodeUpgrades: (
    workflowId: string,
    expectedVersion?: number,
  ) => Promise<WorkflowMutationResult<WorkflowDocument>>;
  clearWorkflowIssues: () => void;
  currentWorkflow: WorkflowDocument;
  isEditorLocked: boolean;
  isWorkflowCurrent: (workflowId: string) => boolean;
  isWorkflowDirty: boolean;
  nodeUpgradePreview: WorkflowUpgradePreview | null;
  onConflict: (action: "activation" | "apply_upgrades", error: unknown) => boolean;
  onMessage: (message: string) => void;
  previewNodeUpgrades: (
    workflowId: string,
  ) => Promise<WorkflowMutationResult<WorkflowUpgradePreview>>;
  publication: WorkflowPublicationStatus | null;
  replaceWorkflow: (workflow: WorkflowDocument, options: { baseline: "clean" }) => void;
  selectedWorkflowId: string;
  selectWorkflow: (workflowId: string) => Promise<unknown>;
  updateActivation: (
    workflowId: string,
    active: boolean,
    expectedVersion?: number,
  ) => Promise<WorkflowMutationResult<WorkflowDocument>>;
  upsertWorkflowSummary: (workflow: WorkflowDocument) => void;
};

export function useWorkflowReleaseActions({
  acceptSavedWorkflow,
  applyNodeUpgrades,
  clearWorkflowIssues,
  currentWorkflow,
  isEditorLocked,
  isWorkflowCurrent,
  isWorkflowDirty,
  nodeUpgradePreview,
  onConflict,
  onMessage,
  previewNodeUpgrades,
  publication,
  replaceWorkflow,
  selectedWorkflowId,
  selectWorkflow,
  updateActivation,
  upsertWorkflowSummary,
}: UseWorkflowReleaseActionsOptions) {
  const updateWorkflowActivation = useCallback(async () => {
    if (!selectedWorkflowId || isEditorLocked || isWorkflowDirty) {
      return;
    }

    const isPublished = publication?.active ?? Boolean(currentWorkflow.active);
    const shouldPublish = !isPublished || Boolean(publication?.has_unpublished_changes);
    const result = await updateActivation(
      selectedWorkflowId,
      shouldPublish,
      currentWorkflow.version,
    );
    if (result.kind === "busy") {
      onMessage("已有工作流变更正在处理，请稍候。");
      return;
    }
    if (result.kind === "stale") {
      return;
    }
    if (result.kind === "error") {
      if (!onConflict("activation", result.error)) {
        onMessage(`更新工作流状态失败：${formatApiError(result.error)}`);
      }
      return;
    }

    const saved = result.value;
    acceptSavedWorkflow(saved);
    upsertWorkflowSummary(saved);
    await selectWorkflow(saved.id);
    if (!isWorkflowCurrent(saved.id)) {
      return;
    }
    onMessage(shouldPublish ? `已发布工作流 v${saved.version}。` : "已停用生产版本。");
  }, [
    acceptSavedWorkflow,
    currentWorkflow.active,
    currentWorkflow.version,
    isEditorLocked,
    isWorkflowCurrent,
    isWorkflowDirty,
    onConflict,
    onMessage,
    publication?.active,
    publication?.has_unpublished_changes,
    selectedWorkflowId,
    selectWorkflow,
    updateActivation,
    upsertWorkflowSummary,
  ]);

  const previewWorkflowNodeUpgrades = useCallback(async () => {
    if (!selectedWorkflowId) {
      onMessage("请先保存工作流，再检查节点升级。");
      return;
    }
    if (isWorkflowDirty) {
      onMessage("当前工作流有未保存变更，请先保存后再检查节点升级。");
      return;
    }

    const result = await previewNodeUpgrades(selectedWorkflowId);
    if (result.kind === "busy") {
      onMessage("已有工作流变更正在处理，请稍候。");
      return;
    }
    if (result.kind === "stale") {
      return;
    }
    if (result.kind === "error") {
      onMessage(`节点升级检查失败：${formatApiError(result.error)}`);
      return;
    }
    if (result.value.upgrades.length === 0) {
      onMessage("当前工作流中的节点都已是最新版本。");
      return;
    }
    onMessage(`发现 ${result.value.upgrades.length} 个可升级节点，请确认变更后应用。`);
  }, [isWorkflowDirty, onMessage, previewNodeUpgrades, selectedWorkflowId]);

  const applyWorkflowNodeUpgrades = useCallback(async () => {
    if (!selectedWorkflowId || !nodeUpgradePreview) {
      return;
    }

    const upgradeCount = nodeUpgradePreview.upgrades.length;
    const result = await applyNodeUpgrades(selectedWorkflowId, currentWorkflow.version);
    if (result.kind === "busy") {
      onMessage("已有工作流变更正在处理，请稍候。");
      return;
    }
    if (result.kind === "stale") {
      return;
    }
    if (result.kind === "error") {
      if (!onConflict("apply_upgrades", result.error)) {
        onMessage(`应用节点升级失败：${formatApiError(result.error)}`);
      }
      return;
    }

    const saved = result.value;
    replaceWorkflow(saved, { baseline: "clean" });
    upsertWorkflowSummary(saved);
    clearWorkflowIssues();
    await selectWorkflow(saved.id);
    if (!isWorkflowCurrent(saved.id)) {
      return;
    }
    onMessage(`已升级 ${upgradeCount} 个节点并保存为 v${saved.version}。`);
  }, [
    applyNodeUpgrades,
    clearWorkflowIssues,
    currentWorkflow.version,
    isWorkflowCurrent,
    nodeUpgradePreview,
    onConflict,
    onMessage,
    replaceWorkflow,
    selectedWorkflowId,
    selectWorkflow,
    upsertWorkflowSummary,
  ]);

  return {
    applyWorkflowNodeUpgrades,
    previewWorkflowNodeUpgrades,
    updateWorkflowActivation,
  };
}
