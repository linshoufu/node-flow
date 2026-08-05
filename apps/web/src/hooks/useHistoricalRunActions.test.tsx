import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkflow } from "../lib/workflow";
import type { RunRecord } from "../types";
import { useHistoricalRunActions } from "./useHistoricalRunActions";

function run(id = "run-1"): RunRecord {
  return {
    id,
    workflow_id: "workflow-1",
    workflow_version: 3,
    status: "succeeded",
    created_at: "2026-08-01T00:00:00Z",
    started_at: null,
    completed_at: null,
    error: null,
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    currentWorkflow: {
      ...createEmptyWorkflow(),
      id: "workflow-1",
      nodes: [{ id: "node-1", type: "test.node", position: { x: 0, y: 0 }, config: {} }],
    },
    editScopeActive: false,
    loadComparisonRun: vi.fn().mockResolvedValue({ kind: "success" }),
    loadHistoricalRun: vi.fn().mockResolvedValue({
      kind: "success",
      run: run(),
      events: [],
      executedWorkflow: null,
      selectedNodeId: "node-1",
    }),
    navigate: vi.fn(),
    onClearPreRunIssues: vi.fn(),
    onExpandRunDrawer: vi.fn(),
    onMessage: vi.fn(),
    onResetRunState: vi.fn(),
    onSelectNode: vi.fn(),
    selectedNodeId: "node-1",
    selectedWorkflowId: "workflow-1",
    showHistoricalRun: vi.fn(),
    ...overrides,
  };
}

describe("useHistoricalRunActions", () => {
  it("打开历史运行并将深链节点切到运行详情", async () => {
    const current = options();
    const { result } = renderHook(() => useHistoricalRunActions(current));

    let acceptedRoute;
    await act(async () => {
      acceptedRoute = await result.current.openHistoricalRun("run-1", { nodeId: "node-1" });
    });

    expect(current.loadHistoricalRun).toHaveBeenCalledWith("run-1", {
      expectedWorkflowId: undefined,
      nodeId: "node-1",
    });
    expect(current.showHistoricalRun).toHaveBeenCalledWith(run(), []);
    expect(current.onExpandRunDrawer).toHaveBeenCalledWith(true);
    expect(current.onSelectNode).toHaveBeenCalledWith("node-1", "runtime");
    expect(acceptedRoute).toEqual({
      kind: "execution",
      workflowId: "workflow-1",
      executionId: "run-1",
      nodeId: "node-1",
    });
    expect(current.navigate).toHaveBeenCalledWith(acceptedRoute);
  });

  it.each([
    [{ kind: "stale" }, null],
    [{ kind: "mismatch" }, "运行记录与当前工作流不匹配，已停止打开。"],
    [{ kind: "error", error: new Error("offline") }, "历史运行加载失败：offline"],
  ])("忽略或解释无法打开的历史运行 %#", async (loadResult, expectedMessage) => {
    const current = options({ loadHistoricalRun: vi.fn().mockResolvedValue(loadResult) });
    const { result } = renderHook(() => useHistoricalRunActions(current));

    let acceptedRoute;
    await act(async () => {
      acceptedRoute = await result.current.openHistoricalRun("run-1");
    });

    expect(acceptedRoute).toBeNull();
    expect(current.showHistoricalRun).not.toHaveBeenCalled();
    if (expectedMessage) {
      expect(current.onMessage).toHaveBeenCalledWith(expectedMessage);
    } else {
      expect(current.onMessage).not.toHaveBeenCalled();
    }
  });

  it("清除历史视图后返回当前工作流和所选节点", () => {
    const current = options();
    const { result } = renderHook(() => useHistoricalRunActions(current));

    act(() => result.current.clearHistoricalRunView());

    expect(current.onResetRunState).toHaveBeenCalledOnce();
    expect(current.navigate).toHaveBeenCalledWith({
      kind: "workflow",
      workflowId: "workflow-1",
      nodeId: "node-1",
    });
    expect(current.onMessage).toHaveBeenCalledWith("已清除历史运行视图。");
  });

  it("子流程编辑范围清除历史视图时不保留根节点深链", () => {
    const current = options({ editScopeActive: true });
    const { result } = renderHook(() => useHistoricalRunActions(current));

    act(() => result.current.clearHistoricalRunView());

    expect(current.navigate).toHaveBeenCalledWith({ kind: "workflow", workflowId: "workflow-1" });
  });

  it("对比目标不存在时给出中文反馈", async () => {
    const current = options({ loadComparisonRun: vi.fn().mockResolvedValue({ kind: "missing" }) });
    const { result } = renderHook(() => useHistoricalRunActions(current));

    await act(() => result.current.selectHistoricalRunForComparison("missing"));
    expect(current.onMessage).toHaveBeenCalledWith("未找到用于对比的历史运行。");
  });
});
