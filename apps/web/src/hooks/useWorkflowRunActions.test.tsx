import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { currentRunView, emptyRunView, historicalRunView } from "../lib/runView";
import { createEmptyWorkflow } from "../lib/workflow";
import type { RunRecord, WorkflowDocument } from "../types";
import { useWorkflowRunActions } from "./useWorkflowRunActions";

function workflow(): WorkflowDocument {
  return {
    ...createEmptyWorkflow(),
    id: "workflow-1",
    version: 3,
    nodes: [{ id: "node-1", type: "test.node", position: { x: 0, y: 0 }, config: {} }],
  };
}

function run(status: RunRecord["status"] = "running", id = "run-1"): RunRecord {
  return {
    id,
    workflow_id: "workflow-1",
    workflow_version: 3,
    status,
    created_at: "2026-08-01T00:00:00Z",
    started_at: null,
    completed_at: null,
    error: null,
  };
}

function terminalPolling(nextRun = run("succeeded")) {
  return {
    kind: "terminal" as const,
    attempts: 1,
    snapshot: { run: nextRun, events: [], queueStatus: null },
  };
}

function options(overrides: Record<string, unknown> = {}) {
  const currentWorkflow = workflow();
  return {
    beginCancelOperation: vi.fn().mockReturnValue(2),
    beginRunOperation: vi.fn().mockReturnValue(1),
    client: {
      cancelRun: vi.fn().mockResolvedValue(run("running")),
      createRun: vi.fn().mockResolvedValue(run("running")),
      retryRun: vi.fn().mockResolvedValue(run("running", "run-retry")),
    },
    currentPreRunIssues: [],
    currentRun: null,
    editableWorkflow: currentWorkflow,
    finishOperation: vi.fn().mockReturnValue(true),
    isBusy: false,
    isCancelling: false,
    isIssueInCurrentScope: vi.fn().mockReturnValue(true),
    isOperationActive: vi.fn().mockReturnValue(true),
    maxPollAttempts: 120,
    navigate: vi.fn(),
    onClearHistoricalRunWorkflow: vi.fn(),
    onExpandRunDrawer: vi.fn(),
    onMessage: vi.fn(),
    onPageBusyChange: vi.fn(),
    onSelectIssueNode: vi.fn(),
    onShowPreRunIssues: vi.fn(),
    refreshWorkflowRunHistory: vi.fn().mockResolvedValue([]),
    runView: emptyRunView(),
    saveWorkflow: vi.fn().mockResolvedValue(currentWorkflow),
    shouldSaveBeforeRun: false,
    trackCurrentRun: vi.fn().mockResolvedValue(terminalPolling()),
    workflow: currentWorkflow,
    ...overrides,
  };
}

describe("useWorkflowRunActions", () => {
  it("运行前问题会打开问题中心并定位当前层级节点", async () => {
    const current = options({
      currentPreRunIssues: [{
        id: "node-1:url",
        nodeId: "node-1",
        nodeType: "test.node",
        severity: "error",
        title: "缺少 URL",
        message: "请填写 URL",
      }],
    });
    const { result } = renderHook(() => useWorkflowRunActions(current));

    await act(() => result.current.runWorkflow());

    expect(current.onShowPreRunIssues).toHaveBeenCalledOnce();
    expect(current.onSelectIssueNode).toHaveBeenCalledWith("node-1");
    expect(current.beginRunOperation).not.toHaveBeenCalled();
    expect(current.onMessage).toHaveBeenCalledWith("运行前检查发现 1 个问题，请先补齐配置。");
  });

  it("复用统一保存通道后创建、跟踪并完成运行", async () => {
    const current = options({ shouldSaveBeforeRun: true });
    const { result } = renderHook(() => useWorkflowRunActions(current));

    await act(() => result.current.runWorkflow("node-1", { id: 1 }, "staging"));

    expect(current.saveWorkflow).toHaveBeenCalledOnce();
    expect(current.client.createRun).toHaveBeenCalledWith(
      "workflow-1",
      "node-1",
      { id: 1 },
      "staging",
    );
    expect(current.navigate).toHaveBeenCalledWith({
      kind: "execution",
      workflowId: "workflow-1",
      executionId: "run-1",
    });
    expect(current.refreshWorkflowRunHistory).toHaveBeenCalledWith({ preserveExistingOnError: true });
    expect(current.onMessage).toHaveBeenLastCalledWith("运行成功。");
    expect(current.onPageBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("保存失败或冲突时不创建运行", async () => {
    const current = options({
      saveWorkflow: vi.fn().mockResolvedValue(null),
      shouldSaveBeforeRun: true,
    });
    const { result } = renderHook(() => useWorkflowRunActions(current));

    await act(() => result.current.runWorkflow());

    expect(current.client.createRun).not.toHaveBeenCalled();
    expect(current.finishOperation).toHaveBeenCalledWith(1);
    expect(current.onPageBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("运行请求失败时只更新当前操作的错误", async () => {
    const current = options({
      client: {
        cancelRun: vi.fn(),
        createRun: vi.fn().mockRejectedValue(new Error("offline")),
        retryRun: vi.fn(),
      },
    });
    const { result } = renderHook(() => useWorkflowRunActions(current));

    await act(() => result.current.runWorkflow());
    expect(current.onMessage).toHaveBeenLastCalledWith("运行失败：offline");
  });

  it("取消当前运行并跟踪到终态", async () => {
    const currentRun = run("running");
    const current = options({
      currentRun,
      runView: currentRunView(currentRun, []),
    });
    const { result } = renderHook(() => useWorkflowRunActions(current));

    await act(() => result.current.cancelRun());

    expect(current.client.cancelRun).toHaveBeenCalledWith("run-1");
    expect(current.trackCurrentRun).toHaveBeenCalledWith({
      fetchImmediately: true,
      run: currentRun,
      token: 2,
    });
    expect(current.onMessage).toHaveBeenLastCalledWith("运行成功。");
  });

  it("历史运行视图不允许取消", async () => {
    const historical = run("running");
    const current = options({
      currentRun: historical,
      runView: historicalRunView(historical, []),
    });
    const { result } = renderHook(() => useWorkflowRunActions(current));

    await act(() => result.current.cancelRun());
    expect(current.beginCancelOperation).not.toHaveBeenCalled();
  });

  it("重试历史运行后切换到新的当前执行", async () => {
    const sourceRun = run("failed", "run-history");
    const retriedRun = run("running", "run-retry");
    const current = options({
      currentRun: sourceRun,
      runView: historicalRunView(sourceRun, []),
      client: {
        cancelRun: vi.fn(),
        createRun: vi.fn(),
        retryRun: vi.fn().mockResolvedValue(retriedRun),
      },
    });
    const { result } = renderHook(() => useWorkflowRunActions(current));

    await act(() => result.current.retryHistoricalRun());

    expect(current.onClearHistoricalRunWorkflow).toHaveBeenCalledOnce();
    expect(current.navigate).toHaveBeenCalledWith({
      kind: "execution",
      workflowId: "workflow-1",
      executionId: "run-retry",
    });
    expect(current.onMessage).toHaveBeenLastCalledWith("已基于 v3 重新运行，结果成功。");
  });
});
