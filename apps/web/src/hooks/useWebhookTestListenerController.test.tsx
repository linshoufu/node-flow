import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebhookTestListener } from "../types";
import { useWebhookTestListenerController } from "./useWebhookTestListenerController";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function listener(
  workflowId = "workflow-1",
  nodeId = "webhook-1",
  expiresInMs = 60_000,
): WebhookTestListener {
  return {
    active: true,
    expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    node_id: nodeId,
    workflow_id: workflowId,
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    client: {
      getWebhookTestListener: vi.fn().mockResolvedValue(listener()),
      startWebhookTestListener: vi.fn().mockResolvedValue(listener()),
      stopWebhookTestListener: vi.fn().mockResolvedValue({
        active: false,
        node_id: "webhook-1",
        workflow_id: "workflow-1",
      }),
    },
    isEditorLocked: false,
    onMessage: vi.fn(),
    pollIntervalMs: 1_000,
    workflowId: "workflow-1",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("useWebhookTestListenerController", () => {
  it("启动和停止当前工作流的调试监听", async () => {
    const current = options();
    const { result } = renderHook(() => useWebhookTestListenerController(current));

    await act(() => result.current.startListening("webhook-1"));

    expect(current.client.startWebhookTestListener).toHaveBeenCalledWith(
      "workflow-1",
      "webhook-1",
    );
    expect(result.current.listener).toEqual(expect.objectContaining({ active: true }));
    expect(result.current.isChanging).toBe(false);
    expect(current.onMessage).toHaveBeenCalledWith("正在监听调试 Webhook，等待一条请求。");

    await act(() => result.current.stopListening("webhook-1"));

    expect(current.client.stopWebhookTestListener).toHaveBeenCalledWith(
      "workflow-1",
      "webhook-1",
    );
    expect(result.current.listener).toBeNull();
    expect(current.onMessage).toHaveBeenLastCalledWith("已停止调试 Webhook 监听。");
  });

  it("未保存或编辑器锁定时不发起监听操作", async () => {
    const unsaved = options({ workflowId: "" });
    const { result, rerender } = renderHook(
      ({ current }) => useWebhookTestListenerController(current),
      { initialProps: { current: unsaved } },
    );

    await act(() => result.current.startListening("webhook-1"));
    expect(unsaved.client.startWebhookTestListener).not.toHaveBeenCalled();

    const locked = options({ isEditorLocked: true });
    rerender({ current: locked });
    await act(() => result.current.stopListening("webhook-1"));
    expect(locked.client.stopWebhookTestListener).not.toHaveBeenCalled();
  });

  it("用同步操作租约阻止快速重复启动", async () => {
    const pending = deferred<WebhookTestListener>();
    const current = options({
      client: {
        getWebhookTestListener: vi.fn(),
        startWebhookTestListener: vi.fn().mockReturnValue(pending.promise),
        stopWebhookTestListener: vi.fn(),
      },
    });
    const { result } = renderHook(() => useWebhookTestListenerController(current));

    let firstRequest!: Promise<WebhookTestListener | null>;
    let secondRequest!: Promise<WebhookTestListener | null>;
    act(() => {
      firstRequest = result.current.startListening("webhook-1");
      secondRequest = result.current.startListening("webhook-1");
    });

    expect(current.client.startWebhookTestListener).toHaveBeenCalledOnce();
    await expect(secondRequest).resolves.toBeNull();
    await act(async () => {
      pending.resolve(listener());
      await firstRequest;
    });
    expect(result.current.listener?.active).toBe(true);
  });

  it("工作流切换后丢弃迟到的启动响应", async () => {
    const pending = deferred<WebhookTestListener>();
    const client = {
      getWebhookTestListener: vi.fn(),
      startWebhookTestListener: vi.fn().mockReturnValue(pending.promise),
      stopWebhookTestListener: vi.fn(),
    };
    const onMessage = vi.fn();
    const { result, rerender } = renderHook(
      ({ workflowId }) => useWebhookTestListenerController({
        client,
        isEditorLocked: false,
        onMessage,
        workflowId,
      }),
      { initialProps: { workflowId: "workflow-1" } },
    );

    let request!: Promise<WebhookTestListener | null>;
    act(() => {
      request = result.current.startListening("webhook-1");
    });
    rerender({ workflowId: "workflow-2" });
    await act(async () => {
      pending.resolve(listener("workflow-1"));
      await request;
    });

    expect(result.current.listener).toBeNull();
    expect(result.current.isChanging).toBe(false);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("轮询发现一次性监听已被消费时清理状态", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    const current = options({
      client: {
        getWebhookTestListener: vi.fn().mockResolvedValue({
          active: false,
          node_id: "webhook-1",
          workflow_id: "workflow-1",
        }),
        startWebhookTestListener: vi.fn().mockResolvedValue(listener()),
        stopWebhookTestListener: vi.fn(),
      },
    });
    const { result } = renderHook(() => useWebhookTestListenerController(current));
    await act(() => result.current.startListening("webhook-1"));
    current.onMessage.mockClear();

    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(result.current.listener).toBeNull();
    expect(current.onMessage).toHaveBeenCalledWith("调试 Webhook 监听已结束。");
  });

  it("监听到期时自动清理并提示", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    const expiringListener = listener("workflow-1", "webhook-1", 1_000);
    const current = options({
      client: {
        getWebhookTestListener: vi.fn(),
        startWebhookTestListener: vi.fn().mockResolvedValue(expiringListener),
        stopWebhookTestListener: vi.fn(),
      },
      pollIntervalMs: 5_000,
    });
    const { result } = renderHook(() => useWebhookTestListenerController(current));
    await act(() => result.current.startListening("webhook-1"));
    current.onMessage.mockClear();

    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(result.current.listener).toBeNull();
    expect(current.onMessage).toHaveBeenCalledWith("调试 Webhook 监听已到期。");
    expect(current.client.getWebhookTestListener).not.toHaveBeenCalled();
  });

  it("临时轮询失败时保留监听状态", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    const current = options({
      client: {
        getWebhookTestListener: vi.fn().mockRejectedValue(new Error("offline")),
        startWebhookTestListener: vi.fn().mockResolvedValue(listener()),
        stopWebhookTestListener: vi.fn(),
      },
    });
    const { result } = renderHook(() => useWebhookTestListenerController(current));
    await act(() => result.current.startListening("webhook-1"));
    current.onMessage.mockClear();

    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(result.current.listener?.active).toBe(true);
    expect(current.onMessage).not.toHaveBeenCalled();
  });

  it("停止监听后不接受迟到的轮询响应", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    const pendingPoll = deferred<WebhookTestListener>();
    const current = options({
      client: {
        getWebhookTestListener: vi.fn().mockReturnValue(pendingPoll.promise),
        startWebhookTestListener: vi.fn().mockResolvedValue(listener()),
        stopWebhookTestListener: vi.fn().mockResolvedValue({
          active: false,
          node_id: "webhook-1",
          workflow_id: "workflow-1",
        }),
      },
    });
    const { result } = renderHook(() => useWebhookTestListenerController(current));
    await act(() => result.current.startListening("webhook-1"));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    await act(() => result.current.stopListening("webhook-1"));
    current.onMessage.mockClear();
    await act(async () => {
      pendingPoll.resolve(listener());
      await Promise.resolve();
    });

    expect(result.current.listener).toBeNull();
    expect(current.onMessage).not.toHaveBeenCalled();
  });

  it("拒绝绑定不属于当前工作流或节点的响应", async () => {
    const current = options({
      client: {
        getWebhookTestListener: vi.fn(),
        startWebhookTestListener: vi.fn().mockResolvedValue(listener("workflow-2", "webhook-9")),
        stopWebhookTestListener: vi.fn(),
      },
    });
    const { result } = renderHook(() => useWebhookTestListenerController(current));

    await act(() => result.current.startListening("webhook-1"));

    expect(result.current.listener).toBeNull();
    expect(current.onMessage).toHaveBeenCalledWith("调试 Webhook 监听未启动，请重试。");
  });
});
