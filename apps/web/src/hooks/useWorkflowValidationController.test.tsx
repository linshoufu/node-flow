import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkflow } from "../lib/workflow";
import type { ValidationResult, WorkflowDocument } from "../types";
import { useWorkflowValidationController } from "./useWorkflowValidationController";

function workflow(id = "workflow-1"): WorkflowDocument {
  return { ...createEmptyWorkflow(), id, name: `工作流 ${id}` };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    blocked: false,
    client: { validateWorkflow: vi.fn().mockResolvedValue({ valid: true, issues: [] }) },
    documentKey: "workflow-1:0",
    onBusyChange: vi.fn(),
    onMessage: vi.fn(),
    workflow: workflow(),
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

describe("useWorkflowValidationController", () => {
  it("验证通过时清除旧问题并恢复忙碌状态", async () => {
    const current = options();
    const { result } = renderHook(() => useWorkflowValidationController(current));

    let validationResult: ValidationResult | null = null;
    await act(async () => {
      validationResult = await result.current.validateWorkflow();
    });

    expect(validationResult).toEqual({ valid: true, issues: [] });
    expect(current.client.validateWorkflow).toHaveBeenCalledWith(current.workflow);
    expect(result.current.issueItems).toEqual([]);
    expect(current.onMessage).toHaveBeenCalledWith("工作流验证通过。");
    expect(current.onBusyChange).toHaveBeenNthCalledWith(1, true);
    expect(current.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("将后端问题转换为可导航的中文问题项", async () => {
    const validationResult: ValidationResult = {
      valid: false,
      issues: [{ path: "nodes.request.config.url", message: "Field required" }],
    };
    const current = options({
      client: { validateWorkflow: vi.fn().mockResolvedValue(validationResult) },
    });
    const { result } = renderHook(() => useWorkflowValidationController(current));

    await act(() => result.current.validateWorkflow());

    expect(result.current.issueItems).toEqual([
      expect.objectContaining({
        field: "url",
        location: "节点 request",
        nodeId: "request",
        targetKind: "node",
        title: "节点配置问题",
      }),
    ]);
    expect(current.onMessage).toHaveBeenCalledWith(
      "工作流有 1 个问题：节点 request 的配置 URL：必填项不能为空",
    );
  });

  it("验证失败时保留当前问题并展示错误", async () => {
    const current = options({
      client: { validateWorkflow: vi.fn().mockRejectedValue(new Error("offline")) },
    });
    const { result } = renderHook(() => useWorkflowValidationController(current));

    await act(() => result.current.validateWorkflow());

    expect(result.current.issueItems).toEqual([]);
    expect(current.onMessage).toHaveBeenCalledWith("验证失败：offline");
    expect(current.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("阻止忙碌状态和快速重复验证", async () => {
    const blocked = options({ blocked: true });
    const { result, rerender } = renderHook(
      ({ current }) => useWorkflowValidationController(current),
      { initialProps: { current: blocked } },
    );
    await act(() => result.current.validateWorkflow());
    expect(blocked.client.validateWorkflow).not.toHaveBeenCalled();

    const pending = deferred<ValidationResult>();
    const available = options({
      client: { validateWorkflow: vi.fn().mockReturnValue(pending.promise) },
    });
    rerender({ current: available });
    let firstRequest!: Promise<ValidationResult | null>;
    let secondRequest!: Promise<ValidationResult | null>;
    act(() => {
      firstRequest = result.current.validateWorkflow();
      secondRequest = result.current.validateWorkflow();
    });

    expect(available.client.validateWorkflow).toHaveBeenCalledOnce();
    await expect(secondRequest).resolves.toBeNull();
    await act(async () => {
      pending.resolve({ valid: true, issues: [] });
      await firstRequest;
    });
  });

  it("工作流修订变化时清除问题并丢弃迟到结果", async () => {
    const pending = deferred<ValidationResult>();
    const current = options({
      client: { validateWorkflow: vi.fn().mockReturnValue(pending.promise) },
    });
    const { result, rerender } = renderHook(
      ({ currentOptions }) => useWorkflowValidationController(currentOptions),
      { initialProps: { currentOptions: current } },
    );

    let request!: Promise<ValidationResult | null>;
    act(() => {
      request = result.current.validateWorkflow();
    });
    rerender({
      currentOptions: {
        ...current,
        documentKey: "workflow-1:1",
        workflow: { ...current.workflow, name: "新修订" },
      },
    });
    await act(async () => {
      pending.resolve({
        valid: false,
        issues: [{ path: "settings.timeout_seconds", message: "Invalid" }],
      });
      await request;
    });

    expect(result.current.issueItems).toEqual([]);
    expect(current.onMessage).not.toHaveBeenCalled();
    expect(current.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("允许调用方主动清除验证问题", async () => {
    const current = options({
      client: {
        validateWorkflow: vi.fn().mockResolvedValue({
          valid: false,
          issues: [{ path: "settings.timeout_seconds", message: "Invalid" }],
        }),
      },
    });
    const { result } = renderHook(() => useWorkflowValidationController(current));
    await act(() => result.current.validateWorkflow());
    expect(result.current.issueItems).toHaveLength(1);

    act(() => result.current.clearValidationIssues());

    expect(result.current.issueItems).toEqual([]);
  });
});
