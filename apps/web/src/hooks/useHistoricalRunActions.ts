import { useCallback } from "react";
import { formatApiError } from "../lib/apiError";
import type { WorkflowRoute } from "../lib/workflowRoute";
import type { ComparisonRunLoadResult, HistoricalRunLoadResult } from "./useRunInspectorController";
import type { RunEvent, RunRecord, WorkflowDocument } from "../types";

export type OpenHistoricalRunOptions = {
  expectedWorkflowId?: string;
  nodeId?: string;
  successMessage?: string;
  updateRoute?: boolean;
};

type UseHistoricalRunActionsOptions = {
  currentWorkflow: WorkflowDocument;
  editScopeActive: boolean;
  loadComparisonRun: (runId: string) => Promise<ComparisonRunLoadResult>;
  loadHistoricalRun: (
    runId: string,
    options: { expectedWorkflowId?: string; nodeId?: string },
  ) => Promise<HistoricalRunLoadResult>;
  navigate: (route: WorkflowRoute) => void;
  onClearPreRunIssues: () => void;
  onExpandRunDrawer: (manuallyPinned: boolean) => void;
  onMessage: (message: string) => void;
  onResetRunState: () => void;
  onSelectNode: (nodeId: string | null, tab: "config" | "runtime") => void;
  selectedNodeId: string | null;
  selectedWorkflowId: string;
  showHistoricalRun: (run: RunRecord, events: RunEvent[]) => void;
};

export function useHistoricalRunActions({
  currentWorkflow,
  editScopeActive,
  loadComparisonRun,
  loadHistoricalRun,
  navigate,
  onClearPreRunIssues,
  onExpandRunDrawer,
  onMessage,
  onResetRunState,
  onSelectNode,
  selectedNodeId,
  selectedWorkflowId,
  showHistoricalRun,
}: UseHistoricalRunActionsOptions) {
  const openHistoricalRun = useCallback(async (
    runId: string,
    {
      expectedWorkflowId,
      nodeId,
      successMessage = "已打开历史运行。",
      updateRoute = true,
    }: OpenHistoricalRunOptions = {},
  ): Promise<WorkflowRoute | null> => {
    const result = await loadHistoricalRun(runId, { expectedWorkflowId, nodeId });
    if (result.kind === "stale") {
      return null;
    }
    if (result.kind === "mismatch") {
      onMessage("运行记录与当前工作流不匹配，已停止打开。");
      return null;
    }
    if (result.kind === "error") {
      onMessage(`历史运行加载失败：${formatApiError(result.error)}`);
      return null;
    }

    showHistoricalRun(result.run, result.events);
    onExpandRunDrawer(true);
    onClearPreRunIssues();
    onSelectNode(
      result.selectedNodeId ?? null,
      result.selectedNodeId ? "runtime" : "config",
    );
    onMessage(successMessage);
    const acceptedRoute: WorkflowRoute = {
      kind: "execution",
      workflowId: result.run.workflow_id,
      executionId: result.run.id,
      ...(result.selectedNodeId ? { nodeId: result.selectedNodeId } : {}),
    };
    if (updateRoute) {
      navigate(acceptedRoute);
    }
    return acceptedRoute;
  }, [
    loadHistoricalRun,
    navigate,
    onClearPreRunIssues,
    onExpandRunDrawer,
    onMessage,
    onSelectNode,
    showHistoricalRun,
  ]);

  const openParentRun = useCallback(async (runId: string) => {
    await openHistoricalRun(runId, { successMessage: "已打开关联运行。" });
  }, [openHistoricalRun]);

  const clearHistoricalRunView = useCallback(() => {
    onResetRunState();
    if (selectedWorkflowId) {
      const selectedCurrentNodeId = !editScopeActive
        && selectedNodeId
        && currentWorkflow.nodes.some((node) => node.id === selectedNodeId)
        ? selectedNodeId
        : undefined;
      navigate({
        kind: "workflow",
        workflowId: selectedWorkflowId,
        ...(selectedCurrentNodeId ? { nodeId: selectedCurrentNodeId } : {}),
      });
    }
    onMessage("已清除历史运行视图。");
  }, [
    currentWorkflow.nodes,
    editScopeActive,
    navigate,
    onMessage,
    onResetRunState,
    selectedNodeId,
    selectedWorkflowId,
  ]);

  const selectHistoricalRunForComparison = useCallback(async (runId: string) => {
    const result = await loadComparisonRun(runId);
    if (result.kind === "missing") {
      onMessage("未找到用于对比的历史运行。");
    }
  }, [loadComparisonRun, onMessage]);

  return {
    clearHistoricalRunView,
    openHistoricalRun,
    openParentRun,
    selectHistoricalRunForComparison,
  };
}
