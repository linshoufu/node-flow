import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkflow } from "../lib/workflow";
import type { WorkflowDocument } from "../types";
import { useWorkflowNavigationActions } from "./useWorkflowNavigationActions";

afterEach(() => vi.restoreAllMocks());

function workflow(id = "workflow-1", version = 3): WorkflowDocument {
  return {
    ...createEmptyWorkflow(),
    id,
    name: `Workflow ${id}`,
    version,
    nodes: [{ id: "node-1", type: "test.node", position: { x: 0, y: 0 }, config: {} }],
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    client: {
      deleteWorkflow: vi.fn().mockResolvedValue(undefined),
      getWorkflow: vi.fn().mockResolvedValue(workflow()),
    },
    createWorkflowFromTemplate: vi.fn().mockReturnValue({ ...workflow("template", 0), name: "模板工作流" }),
    hasActiveOperation: vi.fn().mockReturnValue(false),
    isBusy: false,
    isCancelling: false,
    isWorkflowDirty: false,
    navigate: vi.fn(),
    onApplyDocument: vi.fn(),
    onBusyChange: vi.fn(),
    onMessage: vi.fn(),
    openHistoricalRun: vi.fn().mockResolvedValue({
      kind: "execution",
      workflowId: "workflow-1",
      executionId: "run-1",
    }),
    refreshWorkflowCatalog: vi.fn().mockResolvedValue([]),
    selectedWorkflowId: "workflow-1",
    selectTemplateNode: vi.fn().mockReturnValue("node-1"),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("useWorkflowNavigationActions", () => {
  it("保护未保存修改并给出中文反馈", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const current = options({ isWorkflowDirty: true });
    const { result } = renderHook(() => useWorkflowNavigationActions(current));

    act(() => result.current.startNewWorkflow());

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(current.onApplyDocument).not.toHaveBeenCalled();
    expect(current.onMessage).toHaveBeenCalledWith("已保留当前未保存修改。");
  });

  it("新建工作流时重置文档并写入新建路由", () => {
    const current = options();
    const { result } = renderHook(() => useWorkflowNavigationActions(current));

    act(() => result.current.startNewWorkflow());

    expect(current.onApplyDocument).toHaveBeenCalledWith(expect.objectContaining({
      baseline: "clean",
      message: "已新建工作流。",
      selectedNodeId: null,
      selectedWorkflowId: "",
    }));
    expect(current.navigate).toHaveBeenCalledWith({ kind: "new" });
  });

  it("将模板打开为脏草稿并选中模板入口节点", () => {
    const current = options();
    const { result } = renderHook(() => useWorkflowNavigationActions(current));

    act(() => result.current.applyTemplate("api-template"));

    expect(current.createWorkflowFromTemplate).toHaveBeenCalledWith("api-template");
    expect(current.selectTemplateNode).toHaveBeenCalledWith("api-template");
    expect(current.onApplyDocument).toHaveBeenCalledWith(expect.objectContaining({
      baseline: "dirty",
      message: "已应用模板：模板工作流。",
      selectedNodeId: "node-1",
      selectedWorkflowId: "",
    }));
    expect(current.navigate).toHaveBeenCalledWith({ kind: "new" });
  });

  it("加载工作流时接受存在的节点深链并同步 URL", async () => {
    const loaded = workflow("loaded-1", 5);
    const current = options({
      client: {
        deleteWorkflow: vi.fn(),
        getWorkflow: vi.fn().mockResolvedValue(loaded),
      },
    });
    const { result } = renderHook(() => useWorkflowNavigationActions(current));

    let acceptedRoute;
    await act(async () => {
      acceptedRoute = await result.current.loadWorkflow("loaded-1", { nodeId: "node-1" });
    });

    expect(acceptedRoute).toEqual({ kind: "workflow", workflowId: "loaded-1", nodeId: "node-1" });
    expect(current.onBusyChange).toHaveBeenNthCalledWith(1, true);
    expect(current.onBusyChange).toHaveBeenLastCalledWith(false);
    expect(current.onApplyDocument).toHaveBeenCalledWith(expect.objectContaining({
      baseline: "clean",
      message: "已加载 Workflow loaded-1 v5。",
      selectedNodeId: "node-1",
      selectedWorkflowId: "loaded-1",
    }));
    expect(current.navigate).toHaveBeenCalledWith(acceptedRoute);
  });

  it("丢弃迟到的工作流加载结果", async () => {
    const first = deferred<WorkflowDocument>();
    const second = deferred<WorkflowDocument>();
    const getWorkflow = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const current = options({ client: { deleteWorkflow: vi.fn(), getWorkflow } });
    const { result } = renderHook(() => useWorkflowNavigationActions(current));

    let firstResult;
    let secondResult;
    await act(async () => {
      const firstRequest = result.current.loadWorkflow("first", { confirmDiscard: false });
      const secondRequest = result.current.loadWorkflow("second", { confirmDiscard: false });
      second.resolve(workflow("second", 2));
      secondResult = await secondRequest;
      first.resolve(workflow("first", 1));
      firstResult = await firstRequest;
    });

    expect(firstResult).toBeNull();
    expect(secondResult).toEqual({ kind: "workflow", workflowId: "second" });
    expect(current.onApplyDocument).toHaveBeenCalledOnce();
    expect(current.onApplyDocument).toHaveBeenCalledWith(expect.objectContaining({ selectedWorkflowId: "second" }));
  });

  it("加载失败时保留当前文档并展示错误", async () => {
    const current = options({
      client: {
        deleteWorkflow: vi.fn(),
        getWorkflow: vi.fn().mockRejectedValue(new Error("offline")),
      },
    });
    const { result } = renderHook(() => useWorkflowNavigationActions(current));

    await act(() => result.current.loadWorkflow("workflow-2"));

    expect(current.onApplyDocument).not.toHaveBeenCalled();
    expect(current.onMessage).toHaveBeenCalledWith("工作流加载失败：offline");
    expect(current.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("删除当前工作流后打开空白文档", async () => {
    const current = options();
    const { result } = renderHook(() => useWorkflowNavigationActions(current));

    await act(() => result.current.deleteWorkflow("workflow-1"));

    expect(current.client.deleteWorkflow).toHaveBeenCalledWith("workflow-1");
    expect(current.refreshWorkflowCatalog).toHaveBeenCalledOnce();
    expect(current.onApplyDocument).toHaveBeenCalledWith(expect.objectContaining({
      baseline: "clean",
      message: "已删除当前工作流，已新建空白工作流。",
      selectedWorkflowId: "",
    }));
    expect(current.navigate).toHaveBeenCalledWith({ kind: "new" });
  });

  it("删除失败时恢复忙碌状态并展示中文错误", async () => {
    const current = options({
      client: {
        deleteWorkflow: vi.fn().mockRejectedValue(new Error("permission denied")),
        getWorkflow: vi.fn(),
      },
    });
    const { result } = renderHook(() => useWorkflowNavigationActions(current));

    await act(() => result.current.deleteWorkflow("workflow-1"));

    expect(current.onMessage).toHaveBeenCalledWith("删除工作流失败：permission denied");
    expect(current.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("有操作进行时拒绝浏览器历史导航", async () => {
    const current = options({ isBusy: true });
    const { result } = renderHook(() => useWorkflowNavigationActions(current));

    let acceptedRoute;
    await act(async () => {
      acceptedRoute = await result.current.handleRouteRequest(
        { kind: "workflow", workflowId: "workflow-2" },
        "popstate",
      );
    });

    expect(acceptedRoute).toBeNull();
    expect(current.client.getWorkflow).not.toHaveBeenCalled();
    expect(current.onMessage).toHaveBeenCalledWith("当前操作尚未完成，暂时不能离开这个工作流。");
  });

  it("执行深链先加载所属工作流再打开历史运行", async () => {
    const current = options();
    const { result } = renderHook(() => useWorkflowNavigationActions(current));

    let acceptedRoute;
    await act(async () => {
      acceptedRoute = await result.current.handleRouteRequest(
        {
          kind: "execution",
          workflowId: "workflow-1",
          executionId: "run-1",
          nodeId: "node-1",
        },
        "initial",
      );
    });

    expect(current.client.getWorkflow).toHaveBeenCalledWith("workflow-1");
    expect(current.openHistoricalRun).toHaveBeenCalledWith("run-1", {
      expectedWorkflowId: "workflow-1",
      nodeId: "node-1",
      updateRoute: false,
    });
    expect(acceptedRoute).toEqual({
      kind: "execution",
      workflowId: "workflow-1",
      executionId: "run-1",
    });
  });
});
