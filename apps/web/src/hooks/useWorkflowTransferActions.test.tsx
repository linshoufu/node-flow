import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkflow } from "../lib/workflow";
import type { WorkflowDocument } from "../types";
import { useWorkflowTransferActions } from "./useWorkflowTransferActions";

function workflow(id = "workflow-1", version = 3): WorkflowDocument {
  return {
    ...createEmptyWorkflow(),
    id,
    name: `工作流 ${id}`,
    version,
    nodes: [{ id: "node-1", type: "test.node", position: { x: 0, y: 0 }, config: {} }],
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    blocked: false,
    client: { getWorkflow: vi.fn().mockResolvedValue(workflow("source", 4)) },
    confirmDiscardUnsavedChanges: vi.fn().mockResolvedValue(true),
    currentWorkflow: workflow(),
    documentId: "workflow-1",
    download: vi.fn(),
    navigateToNew: vi.fn(),
    onBusyChange: vi.fn(),
    onMessage: vi.fn(),
    onOpenDraft: vi.fn(),
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

function importFile(serialized: string | Promise<string>): File {
  const file = new File(["workflow"], "workflow.json", { type: "application/json" });
  Object.defineProperty(file, "text", {
    value: vi.fn().mockReturnValue(Promise.resolve(serialized)),
  });
  return file;
}

describe("useWorkflowTransferActions", () => {
  it("将服务端工作流复制为新的脏草稿", async () => {
    const current = options();
    const { result } = renderHook(() => useWorkflowTransferActions(current));

    let draft: WorkflowDocument | null = null;
    await act(async () => {
      draft = await result.current.duplicateWorkflow("source");
    });

    expect(current.client.getWorkflow).toHaveBeenCalledWith("source");
    expect(draft).toMatchObject({ name: "工作流 source 副本", version: 1, active: false });
    expect(draft?.id).not.toBe("source");
    expect(current.onOpenDraft).toHaveBeenCalledWith(
      draft,
      "已复制 工作流 source，保存后会成为新的工作流。",
    );
    expect(current.navigateToNew).toHaveBeenCalledOnce();
    expect(current.onBusyChange).toHaveBeenNthCalledWith(1, true);
    expect(current.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("用户拒绝丢弃修改时不读取源工作流", async () => {
    const current = options({ confirmDiscardUnsavedChanges: vi.fn().mockResolvedValue(false) });
    const { result } = renderHook(() => useWorkflowTransferActions(current));

    await act(() => result.current.duplicateWorkflow("source"));

    expect(current.client.getWorkflow).not.toHaveBeenCalled();
    expect(current.onBusyChange).not.toHaveBeenCalled();
    expect(current.onOpenDraft).not.toHaveBeenCalled();
  });

  it("复制失败时保留当前文档并恢复忙碌状态", async () => {
    const current = options({
      client: { getWorkflow: vi.fn().mockRejectedValue(new Error("not found")) },
    });
    const { result } = renderHook(() => useWorkflowTransferActions(current));

    await act(() => result.current.duplicateWorkflow("missing"));

    expect(current.onOpenDraft).not.toHaveBeenCalled();
    expect(current.navigateToNew).not.toHaveBeenCalled();
    expect(current.onMessage).toHaveBeenCalledWith("复制工作流失败：not found");
    expect(current.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("切换文档后丢弃迟到的复制结果", async () => {
    const pending = deferred<WorkflowDocument>();
    const current = options({
      client: { getWorkflow: vi.fn().mockReturnValue(pending.promise) },
    });
    const { result, rerender } = renderHook(
      ({ currentOptions }) => useWorkflowTransferActions(currentOptions),
      { initialProps: { currentOptions: current } },
    );

    let request!: Promise<WorkflowDocument | null>;
    act(() => {
      request = result.current.duplicateWorkflow("source");
    });
    // 异步确认未结算前切换文档：确认后应直接丢弃结果，不再进入 busy 传输
    rerender({
      currentOptions: {
        ...current,
        currentWorkflow: workflow("workflow-2"),
        documentId: "workflow-2",
      },
    });
    await act(async () => {
      pending.resolve(workflow("source", 4));
      await request;
    });

    expect(current.onOpenDraft).not.toHaveBeenCalled();
    expect(current.navigateToNew).not.toHaveBeenCalled();
    expect(current.onMessage).not.toHaveBeenCalled();
    expect(current.onBusyChange).not.toHaveBeenCalled();
  });

  it("导入 JSON 文件并打开新的未保存草稿", async () => {
    const current = options();
    const file = importFile(JSON.stringify(workflow("imported", 7)));
    const { result } = renderHook(() => useWorkflowTransferActions(current));

    let imported: WorkflowDocument | null = null;
    await act(async () => {
      imported = await result.current.importWorkflow(file);
    });

    expect(imported).toMatchObject({ name: "工作流 imported 副本", version: 1, active: false });
    expect(current.onOpenDraft).toHaveBeenCalledWith(
      imported,
      "已导入 工作流 imported 副本，请验证并保存为新的工作流。",
    );
    expect(current.navigateToNew).toHaveBeenCalledOnce();
  });

  it("导入无效文件时显示中文错误", async () => {
    const current = options();
    const { result } = renderHook(() => useWorkflowTransferActions(current));

    await act(() => result.current.importWorkflow(importFile("not json")));

    expect(current.onOpenDraft).not.toHaveBeenCalled();
    expect(current.onMessage).toHaveBeenCalledWith("导入工作流失败：导入文件不是有效的 JSON。");
    expect(current.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("切换文档后忽略迟到的文件读取结果", async () => {
    const pending = deferred<string>();
    const current = options();
    const file = importFile(pending.promise);
    const { result, rerender } = renderHook(
      ({ currentOptions }) => useWorkflowTransferActions(currentOptions),
      { initialProps: { currentOptions: current } },
    );

    let request!: Promise<WorkflowDocument | null>;
    act(() => {
      request = result.current.importWorkflow(file);
    });
    rerender({
      currentOptions: {
        ...current,
        currentWorkflow: workflow("workflow-2"),
        documentId: "workflow-2",
      },
    });
    await act(async () => {
      pending.resolve(JSON.stringify(workflow("imported")));
      await request;
    });

    expect(current.onOpenDraft).not.toHaveBeenCalled();
    expect(current.onMessage).not.toHaveBeenCalled();
  });

  it("导出当前工作流的版本化 JSON 文件", () => {
    const current = options({ currentWorkflow: workflow("exported", 5) });
    const { result } = renderHook(() => useWorkflowTransferActions(current));

    let exported = false;
    act(() => {
      exported = result.current.exportWorkflow();
    });

    expect(exported).toBe(true);
    expect(current.download).toHaveBeenCalledWith(expect.any(String), "工作流-exported.json");
    const [serialized] = current.download.mock.calls[0];
    expect(JSON.parse(serialized)).toMatchObject({
      format: "node-flow/workflow",
      version: 1,
      workflow: { id: "exported", version: 5 },
    });
    expect(current.onMessage).toHaveBeenCalledWith("已导出 工作流 exported。");
  });

  it("下载适配器失败时给出错误且不抛到视图", () => {
    const current = options({ download: vi.fn(() => { throw new Error("download blocked"); }) });
    const { result } = renderHook(() => useWorkflowTransferActions(current));

    let exported = true;
    act(() => {
      exported = result.current.exportWorkflow();
    });

    expect(exported).toBe(false);
    expect(current.onMessage).toHaveBeenCalledWith("导出工作流失败：download blocked");
  });

  it("同步租约阻止快速重复传输和重复确认", async () => {
    const pending = deferred<WorkflowDocument>();
    const current = options({
      client: { getWorkflow: vi.fn().mockReturnValue(pending.promise) },
    });
    const { result } = renderHook(() => useWorkflowTransferActions(current));

    let firstRequest!: Promise<WorkflowDocument | null>;
    let secondRequest!: Promise<WorkflowDocument | null>;
    act(() => {
      firstRequest = result.current.duplicateWorkflow("source");
      secondRequest = result.current.duplicateWorkflow("source");
    });

    // 第二次调用在确认前被同步拒绝；首次确认在微任务中继续推进
    await expect(secondRequest).resolves.toBeNull();
    expect(current.confirmDiscardUnsavedChanges).toHaveBeenCalledOnce();
    expect(current.client.getWorkflow).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve(workflow("source"));
      await firstRequest;
    });
  });
});
