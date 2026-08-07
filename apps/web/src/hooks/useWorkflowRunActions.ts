import { useCallback } from "react";
import type { ApiClient } from "../api/client";
import { apiClient } from "../api/client";
import { formatApiError } from "../lib/apiError";
import { isNodePreRunIssue, type PreRunIssue } from "../lib/preRunChecks";
import type { RunPollingResult } from "../lib/runPolling";
import {
  isHistoricalRunView,
  isTerminalRunStatus,
  type RunViewState,
} from "../lib/runView";
import { normalizeWorkflowDocument } from "../lib/workflow";
import type { RunRecord, RunStatus, WorkflowDocument } from "../types";
import type { WorkflowRoute } from "../lib/workflowRoute";

type WorkflowRunClient = Pick<ApiClient, "cancelRun" | "createRun" | "retryRun">;

type UseWorkflowRunActionsOptions = {
  beginCancelOperation: () => number;
  beginRunOperation: () => number | null;
  client?: WorkflowRunClient;
  currentPreRunIssues: PreRunIssue[];
  currentRun: RunRecord | null;
  editableWorkflow: Pick<WorkflowDocument, "nodes">;
  finishOperation: (token: number) => boolean;
  isBusy: boolean;
  isCancelling: boolean;
  isIssueInCurrentScope: (path: string[] | undefined) => boolean;
  isOperationActive: (token: number) => boolean;
  maxPollAttempts: number;
  navigate: (route: WorkflowRoute) => void;
  onClearHistoricalRunWorkflow: () => void;
  onExpandRunDrawer: () => void;
  onMessage: (message: string) => void;
  onPageBusyChange: (busy: boolean) => void;
  onSelectIssueNode: (nodeId: string) => void;
  onShowPreRunIssues: () => void;
  runView: RunViewState;
  saveWorkflow: () => Promise<WorkflowDocument | null>;
  shouldSaveBeforeRun: boolean;
  trackCurrentRun: (options: {
    fetchImmediately?: boolean;
    run: RunRecord;
    token: number;
  }) => Promise<RunPollingResult>;
  workflow: WorkflowDocument;
};

export function useWorkflowRunActions({
  beginCancelOperation,
  beginRunOperation,
  client = apiClient,
  currentPreRunIssues,
  currentRun,
  editableWorkflow,
  finishOperation,
  isBusy,
  isCancelling,
  isIssueInCurrentScope,
  isOperationActive,
  maxPollAttempts,
  navigate,
  onClearHistoricalRunWorkflow,
  onExpandRunDrawer,
  onMessage,
  onPageBusyChange,
  onSelectIssueNode,
  onShowPreRunIssues,
  runView,
  saveWorkflow,
  shouldSaveBeforeRun,
  trackCurrentRun,
  workflow,
}: UseWorkflowRunActionsOptions) {
  const runWorkflow = useCallback(async (
    entryNodeId?: string,
    initialInput?: unknown,
    environmentId?: string,
  ) => {
    const issues = currentPreRunIssues;
    if (issues.length > 0) {
      onShowPreRunIssues();
      const firstNodeIssue = issues.find(isNodePreRunIssue);
      if (
        firstNodeIssue
        && isIssueInCurrentScope(firstNodeIssue.path)
        && editableWorkflow.nodes.some((node) => node.id === firstNodeIssue.nodeId)
      ) {
        onSelectIssueNode(firstNodeIssue.nodeId);
      }
      onMessage(`运行前检查发现 ${issues.length} 个问题，请先补齐配置。`);
      return;
    }

    const runToken = beginRunOperation();
    if (runToken === null) {
      return;
    }
    onExpandRunDrawer();
    onPageBusyChange(true);
    try {
      const saved = shouldSaveBeforeRun
        ? await saveWorkflow()
        : normalizeWorkflowDocument(workflow);
      if (!saved || !isOperationActive(runToken)) {
        return;
      }
      onMessage(
        shouldSaveBeforeRun
          ? entryNodeId
            ? `已保存 v${saved.version}，正在从所选节点运行...`
            : `已保存 v${saved.version}，正在运行...`
          : entryNodeId
            ? `正在从已保存版本 v${saved.version} 的所选节点运行...`
            : `正在运行已保存版本 v${saved.version}...`,
      );

      let nextRun = await client.createRun(saved.id, entryNodeId, initialInput, environmentId);
      if (!isOperationActive(runToken)) {
        return;
      }
      navigate({
        kind: "execution",
        workflowId: nextRun.workflow_id,
        executionId: nextRun.id,
      });
      const pollingResult = await trackCurrentRun({ run: nextRun, token: runToken });
      if (pollingResult.kind === "cancelled") {
        return;
      }
      nextRun = pollingResult.snapshot.run;
      if (!isOperationActive(runToken)) {
        return;
      }
      // 运行历史由终态事件总线自动刷新，这里只负责结果提示
      onMessage(
        isTerminalRunStatus(nextRun.status)
          ? `运行${formatRunStatus(nextRun.status)}。`
          : `运行轮询超时，已尝试 ${maxPollAttempts} 次。`,
      );
    } catch (error) {
      if (isOperationActive(runToken)) {
        onMessage(`运行失败：${formatApiError(error)}`);
      }
    } finally {
      if (finishOperation(runToken)) {
        onPageBusyChange(false);
      }
    }
  }, [
    beginRunOperation,
    client,
    currentPreRunIssues,
    editableWorkflow.nodes,
    finishOperation,
    isOperationActive,
    isIssueInCurrentScope,
    maxPollAttempts,
    navigate,
    onExpandRunDrawer,
    onMessage,
    onPageBusyChange,
    onSelectIssueNode,
    onShowPreRunIssues,
    saveWorkflow,
    shouldSaveBeforeRun,
    trackCurrentRun,
    workflow,
  ]);

  const cancelRun = useCallback(async () => {
    if (
      !currentRun
      || isTerminalRunStatus(currentRun.status)
      || isCancelling
      || isHistoricalRunView(runView)
    ) {
      return;
    }

    const cancelToken = beginCancelOperation();
    onPageBusyChange(true);
    onMessage("正在请求取消运行...");
    try {
      let nextRun = await client.cancelRun(currentRun.id);
      if (!isOperationActive(cancelToken)) {
        return;
      }
      const pollingResult = await trackCurrentRun({
        fetchImmediately: true,
        run: nextRun,
        token: cancelToken,
      });
      if (pollingResult.kind === "cancelled") {
        return;
      }
      nextRun = pollingResult.snapshot.run;
      // 运行历史由终态事件总线自动刷新，这里只负责结果提示
      onMessage(
        isTerminalRunStatus(nextRun.status)
          ? `运行${formatRunStatus(nextRun.status)}。`
          : `运行取消后轮询超时，已尝试 ${maxPollAttempts} 次。`,
      );
    } catch (error) {
      if (isOperationActive(cancelToken)) {
        onMessage(`取消运行失败：${formatApiError(error)}`);
      }
    } finally {
      if (finishOperation(cancelToken)) {
        onPageBusyChange(false);
      }
    }
  }, [
    beginCancelOperation,
    client,
    currentRun,
    finishOperation,
    isCancelling,
    isOperationActive,
    maxPollAttempts,
    onMessage,
    onPageBusyChange,
    runView,
    trackCurrentRun,
  ]);

  const retryHistoricalRun = useCallback(async () => {
    if (!currentRun || !isHistoricalRunView(runView) || isBusy) {
      return;
    }

    const sourceRun = currentRun;
    const runToken = beginRunOperation();
    if (runToken === null) {
      return;
    }
    onPageBusyChange(true);
    onExpandRunDrawer();
    onMessage(`正在基于 v${sourceRun.workflow_version} 重新运行...`);
    try {
      let nextRun = await client.retryRun(sourceRun.id);
      if (!isOperationActive(runToken)) {
        return;
      }
      onClearHistoricalRunWorkflow();
      navigate({
        kind: "execution",
        workflowId: nextRun.workflow_id,
        executionId: nextRun.id,
      });
      const pollingResult = await trackCurrentRun({ run: nextRun, token: runToken });
      if (pollingResult.kind === "cancelled") {
        return;
      }
      nextRun = pollingResult.snapshot.run;
      if (!isOperationActive(runToken)) {
        return;
      }
      // 运行历史由终态事件总线自动刷新，这里只负责结果提示
      onMessage(
        isTerminalRunStatus(nextRun.status)
          ? `已基于 v${sourceRun.workflow_version} 重新运行，结果${formatRunStatus(nextRun.status)}。`
          : `重新运行轮询超时，已尝试 ${maxPollAttempts} 次。`,
      );
    } catch (error) {
      if (isOperationActive(runToken)) {
        onMessage(`重新运行失败：${formatApiError(error)}`);
      }
    } finally {
      if (finishOperation(runToken)) {
        onPageBusyChange(false);
      }
    }
  }, [
    beginRunOperation,
    client,
    currentRun,
    finishOperation,
    isBusy,
    isOperationActive,
    maxPollAttempts,
    navigate,
    onClearHistoricalRunWorkflow,
    onExpandRunDrawer,
    onMessage,
    onPageBusyChange,
    runView,
    trackCurrentRun,
  ]);

  return { cancelRun, retryHistoricalRun, runWorkflow };
}

function formatRunStatus(status: RunStatus): string {
  switch (status) {
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "running":
      return "运行中";
    case "queued":
      return "排队中";
  }
}
