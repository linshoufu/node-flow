import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWorkbenchNavigationController } from "./useWorkbenchNavigationController";

describe("useWorkbenchNavigationController", () => {
  it("以无选择的根画布状态启动", () => {
    const { result } = renderHook(() => useWorkbenchNavigationController());

    expect(result.current.editScope).toBeUndefined();
    expect(result.current.selectedNodeId).toBeNull();
    expect(result.current.selectedNodeIds).toEqual([]);
    expect(result.current.edgeFocusRequest).toBeNull();
    expect(result.current.configPanelTabRequest).toEqual({ tab: "config", key: 0 });
    expect(result.current.fitRequestKey).toBe(0);
  });

  it("选择节点时原子更新多选、配置标签并清除旧连线焦点", () => {
    const { result } = renderHook(() => useWorkbenchNavigationController());
    act(() => result.current.focusEdge("edge-1"));

    act(() => result.current.selectNodeForPanel(
      "node-2",
      "config",
      "url",
      ["node-1", "node-2"],
    ));

    expect(result.current.selectedNodeId).toBe("node-2");
    expect(result.current.selectedNodeIds).toEqual(["node-1", "node-2"]);
    expect(result.current.edgeFocusRequest).toBeNull();
    expect(result.current.runtimeNavigationSource).toBeNull();
    expect(result.current.configPanelTabRequest).toEqual({
      field: "url",
      key: 1,
      tab: "config",
    });
  });

  it("从运行结果打开节点时保留来源和子流程作用域", () => {
    const { result } = renderHook(() => useWorkbenchNavigationController());

    act(() => result.current.openRuntimeSelection({
      nodeId: "request",
      scope: ["loop", "body"],
      source: "run_event",
    }));

    expect(result.current.selectedNodeId).toBe("request");
    expect(result.current.selectedNodeIds).toEqual(["request"]);
    expect(result.current.runtimeNavigationSource).toBe("run_event");
    expect(result.current.runtimeNavigationScope).toEqual(["loop", "body"]);
    expect(result.current.configPanelTabRequest).toEqual({ tab: "runtime", key: 1 });
  });

  it("聚焦连线时清空节点和运行详情，并为重复聚焦递增请求键", () => {
    const { result } = renderHook(() => useWorkbenchNavigationController());
    act(() => result.current.openRuntimeSelection({
      nodeId: "request",
      scope: [],
      source: "canvas",
    }));

    act(() => result.current.focusEdge("edge-1"));
    expect(result.current.selectedNodeId).toBeNull();
    expect(result.current.selectedNodeIds).toEqual([]);
    expect(result.current.runtimeNavigationSource).toBeNull();
    expect(result.current.runtimeNavigationScope).toBeNull();
    expect(result.current.edgeFocusRequest).toEqual({ edgeId: "edge-1", key: 1 });

    act(() => result.current.focusEdge("edge-1"));
    expect(result.current.edgeFocusRequest).toEqual({ edgeId: "edge-1", key: 2 });
  });

  it("进入嵌套子流程时清除选择并请求重新适配画布", () => {
    const { result } = renderHook(() => useWorkbenchNavigationController());
    act(() => result.current.selectNodeForPanel("loop-1"));

    act(() => result.current.enterSubflow("loop-1", "body"));
    act(() => result.current.enterSubflow("loop-2", "body"));

    expect(result.current.editScope).toEqual([
      { nodeId: "loop-1", subflowName: "body" },
      { nodeId: "loop-2", subflowName: "body" },
    ]);
    expect(result.current.selectedNodeId).toBeNull();
    expect(result.current.fitRequestKey).toBe(2);

    act(() => result.current.returnToMain());
    expect(result.current.editScope).toBeUndefined();
    expect(result.current.fitRequestKey).toBe(3);
  });

  it("恢复编辑历史时同步恢复层级和主节点选择", () => {
    const { result } = renderHook(() => useWorkbenchNavigationController());

    act(() => result.current.restoreHistorySelection(
      [{ nodeId: "loop", subflowName: "body" }],
      "log",
    ));

    expect(result.current.editScope).toEqual([{ nodeId: "loop", subflowName: "body" }]);
    expect(result.current.selectedNodeId).toBe("log");
    expect(result.current.selectedNodeIds).toEqual(["log"]);
    expect(result.current.configPanelTabRequest.tab).toBe("config");
  });

  it("加载文档时回到根层级、重置选择并请求适配画布", () => {
    const { result } = renderHook(() => useWorkbenchNavigationController());
    act(() => result.current.enterSubflow("loop", "body"));
    act(() => result.current.focusEdge("edge-1"));

    act(() => result.current.resetForDocument("entry"));

    expect(result.current.editScope).toBeUndefined();
    expect(result.current.selectedNodeId).toBe("entry");
    expect(result.current.selectedNodeIds).toEqual(["entry"]);
    expect(result.current.edgeFocusRequest).toBeNull();
    expect(result.current.fitRequestKey).toBe(2);
  });
});
