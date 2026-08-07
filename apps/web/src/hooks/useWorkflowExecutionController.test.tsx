import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import type { RunEvent, RunQueueStatus, RunRecord } from "../types";
import {
  useWorkflowExecutionController,
  type WorkflowExecutionClient,
} from "./useWorkflowExecutionController";

function run(status: RunRecord["status"], id = "run-1"): RunRecord {
  return {
    id,
    workflow_id: "workflow-1",
    workflow_version: 1,
    status,
    created_at: "2026-08-01T00:00:00Z",
    started_at: null,
    completed_at: null,
    error: null,
  };
}

function event(type: string): RunEvent {
  return {
    run_id: "run-1",
    type,
    timestamp: "2026-08-01T00:00:01Z",
    scope: [],
    payload: {},
  };
}

function queueStatus(): RunQueueStatus {
  return {
    run_id: "run-1",
    state: "running",
    position: null,
    active_count: 1,
    concurrency_limit: 2,
  };
}

function client(overrides: Partial<WorkflowExecutionClient> = {}): WorkflowExecutionClient {
  return {
    getRun: vi.fn().mockResolvedValue(run("succeeded")),
    getRunEvents: vi.fn().mockResolvedValue([]),
    getRunQueueStatus: vi.fn().mockResolvedValue(null),
    eventsAfter: vi.fn().mockResolvedValue([]),
    runEventStreamUrl: vi.fn().mockReturnValue("http://127.0.0.1:8150/api/runs/run-1/events/stream"),
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

describe("useWorkflowExecutionController", () => {
  it("owns operation tokens and prevents overlapping run starts", () => {
    const { result } = renderHook(() => useWorkflowExecutionController({ client: client() }));
    let token = 0;

    act(() => {
      token = result.current.beginRunOperation() ?? 0;
    });

    expect(token).toBeGreaterThan(0);
    expect(result.current.hasActiveOperation()).toBe(true);
    expect(result.current.beginRunOperation()).toBeNull();
    expect(result.current.isOperationActive(token)).toBe(true);

    act(() => {
      expect(result.current.finishOperation(token)).toBe(true);
    });
    expect(result.current.hasActiveOperation()).toBe(false);
  });

  it("invalidates an active run when cancellation begins", () => {
    const { result } = renderHook(() => useWorkflowExecutionController({ client: client() }));
    let runToken = 0;
    let cancelToken = 0;

    act(() => {
      runToken = result.current.beginRunOperation() ?? 0;
      cancelToken = result.current.beginCancelOperation();
    });

    expect(result.current.isOperationActive(runToken)).toBe(false);
    expect(result.current.isOperationActive(cancelToken)).toBe(true);
    expect(result.current.isCancelling).toBe(true);

    act(() => {
      result.current.finishOperation(cancelToken);
    });
    expect(result.current.isCancelling).toBe(false);
  });

  it("hydrates and polls a current run into one terminal view", async () => {
    const started = run("running");
    const completed = run("succeeded");
    const initialEvents = [event("node_started")];
    const completedEvents = [...initialEvents, event("run_succeeded")];
    const executionClient = client({
      getRun: vi.fn().mockResolvedValue(completed),
      getRunEvents: vi.fn()
        .mockResolvedValueOnce(initialEvents)
        .mockResolvedValueOnce(completedEvents),
      getRunQueueStatus: vi.fn()
        .mockResolvedValueOnce(queueStatus())
        .mockResolvedValueOnce(null),
    });
    const { result } = renderHook(() => useWorkflowExecutionController({
      client: executionClient,
      pollIntervalMs: 0,
      wait: vi.fn().mockResolvedValue(undefined),
    }));
    const token = result.current.beginRunOperation()!;

    let trackingResult: Awaited<ReturnType<typeof result.current.trackCurrentRun>> | undefined;
    await act(async () => {
      trackingResult = await result.current.trackCurrentRun({ run: started, token });
    });

    expect(trackingResult?.kind).toBe("terminal");
    expect(result.current.runView.mode).toBe("current");
    expect(result.current.runView.run).toEqual(completed);
    expect(result.current.runView.events).toEqual(completedEvents);
    expect(result.current.queueStatus).toBeNull();
  });

  it("ignores hydration results after the operation is superseded", async () => {
    const eventsRequest = deferred<RunEvent[]>();
    const executionClient = client({
      getRunEvents: vi.fn().mockReturnValue(eventsRequest.promise),
    });
    const { result } = renderHook(() => useWorkflowExecutionController({ client: executionClient }));
    const token = result.current.beginRunOperation()!;
    let trackingPromise!: ReturnType<typeof result.current.trackCurrentRun>;

    act(() => {
      trackingPromise = result.current.trackCurrentRun({ run: run("running"), token });
    });
    act(() => {
      result.current.beginCancelOperation();
      eventsRequest.resolve([event("stale")]);
    });
    await act(async () => trackingPromise);

    expect(result.current.runView.events).toEqual([]);
    expect(result.current.runView.run?.status).toBe("running");
  });

  it("keeps run tracking available when queue status loading fails", async () => {
    const completed = run("succeeded");
    const executionClient = client({
      getRunEvents: vi.fn().mockResolvedValue([event("run_succeeded")]),
      getRunQueueStatus: vi.fn().mockRejectedValue(new Error("queue unavailable")),
    });
    const { result } = renderHook(() => useWorkflowExecutionController({ client: executionClient }));
    const token = result.current.beginRunOperation()!;

    await act(async () => {
      await result.current.trackCurrentRun({ run: completed, token });
    });

    expect(result.current.runView.run).toEqual(completed);
    expect(result.current.queueStatus).toBeNull();
  });

  it("skips the SSE stream when initial events already contain a terminal event", async () => {
    // 快速 run：拉取初始事件时 run 已实际结束（事件含终态，但 run 记录还是旧状态）。
    // 此时不应再打开 SSE（回放只会重复且服务端立即关流），而是立即轮询收尾
    const completed = run("succeeded");
    const wait = vi.fn().mockResolvedValue(undefined);
    const executionClient = client({
      getRun: vi.fn().mockResolvedValue(completed),
      getRunEvents: vi.fn().mockResolvedValue([
        event("node_started"),
        event("run_succeeded"),
      ]),
    });
    const { result } = renderHook(() => useWorkflowExecutionController({
      client: executionClient,
      pollIntervalMs: 0,
      wait,
    }));
    const token = result.current.beginRunOperation()!;

    let trackingResult: Awaited<ReturnType<typeof result.current.trackCurrentRun>> | undefined;
    await act(async () => {
      trackingResult = await result.current.trackCurrentRun({ run: run("running"), token });
    });

    expect(trackingResult?.kind).toBe("terminal");
    // 未打开 SSE：不应请求流地址与断线补齐
    expect(executionClient.runEventStreamUrl).not.toHaveBeenCalled();
    expect(executionClient.eventsAfter).not.toHaveBeenCalled();
    // 事件已含终态：立即拉取最终状态，不等待轮询间隔
    expect(wait).not.toHaveBeenCalled();
    expect(result.current.runView.run).toEqual(completed);
  });

  it("clears queue state when switching to history and when resetting", async () => {
    const executionClient = client({
      getRunEvents: vi.fn().mockResolvedValue([]),
      getRunQueueStatus: vi.fn().mockResolvedValue(queueStatus()),
    });
    const { result } = renderHook(() => useWorkflowExecutionController({ client: executionClient }));
    const token = result.current.beginRunOperation()!;
    await act(async () => {
      await result.current.trackCurrentRun({ run: run("succeeded"), token });
    });
    expect(result.current.queueStatus).not.toBeNull();

    act(() => result.current.showHistoricalRun(run("failed", "history-1"), [event("run_failed")]));
    expect(result.current.runView.mode).toBe("history");
    expect(result.current.queueStatus).toBeNull();

    act(() => result.current.resetRunState());
    expect(result.current.runView.mode).toBe("empty");
    expect(result.current.queueStatus).toBeNull();
  });

  it("remains usable under the application StrictMode lifecycle", async () => {
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(
      () => useWorkflowExecutionController({ client: client() }),
      { wrapper },
    );

    let token = 0;
    act(() => {
      token = result.current.beginRunOperation() ?? 0;
    });
    await waitFor(() => expect(result.current.isOperationActive(token)).toBe(true));
  });
});
