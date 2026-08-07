import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { apiClient } from "../api/client";
import {
  pollRunUntilTerminal,
  type RunPollingResult,
  type RunPollingSnapshot,
} from "../lib/runPolling";
import { notifyRunTerminal } from "../lib/runTerminalBus";
import {
  currentRunView,
  emptyRunView,
  historicalRunView,
  isTerminalRunStatus,
  type RunViewState,
} from "../lib/runView";
import {
  isRunEventStreamSupported,
  isTerminalRunEvent,
  maxRunEventId,
  mergeRunEvents,
  openRunEventStream,
} from "./useRunEventStream";
import type { RunEvent, RunQueueStatus, RunRecord } from "../types";

export type WorkflowExecutionClient = Pick<
  ApiClient,
  | "getRun"
  | "getRunEvents"
  | "getRunQueueStatus"
  | "eventsAfter"
  | "runEventStreamUrl"
>;

type UseWorkflowExecutionControllerOptions = {
  client?: WorkflowExecutionClient;
  maxPollAttempts?: number;
  pollIntervalMs?: number;
  streamStatusPollIntervalMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
};

type TrackCurrentRunOptions = {
  fetchImmediately?: boolean;
  run: RunRecord;
  token: number;
};

type TrackWithStreamOptions = {
  initialEvents: RunEvent[];
  initialQueueStatus: RunQueueStatus | null;
  run: RunRecord;
  token: number;
};

// 轮询降级不再设次数上限：运行中持续跟踪直到终态或组件卸载/run 切换
const DEFAULT_MAX_POLL_ATTEMPTS = Number.POSITIVE_INFINITY;
const DEFAULT_POLL_INTERVAL_MS = 2000;
// stream 模式下 run 状态与队列状态的低频轮询间隔（事件本身走 SSE 增量）
const DEFAULT_STREAM_STATUS_POLL_INTERVAL_MS = 2500;

export function useWorkflowExecutionController({
  client = apiClient,
  maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  streamStatusPollIntervalMs = DEFAULT_STREAM_STATUS_POLL_INTERVAL_MS,
  wait,
}: UseWorkflowExecutionControllerOptions = {}) {
  const [runView, setRunView] = useState<RunViewState>(() => emptyRunView());
  const [queueStatus, setQueueStatus] = useState<RunQueueStatus | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const mountedRef = useRef(true);
  const operationTokenRef = useRef(0);
  const operationInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationTokenRef.current += 1;
      operationInFlightRef.current = false;
    };
  }, []);

  const isOperationActive = useCallback((token: number) =>
    mountedRef.current && operationTokenRef.current === token, []);

  const hasActiveOperation = useCallback(() => operationInFlightRef.current, []);

  const beginRunOperation = useCallback((): number | null => {
    if (operationInFlightRef.current) {
      return null;
    }
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    operationInFlightRef.current = true;
    setIsCancelling(false);
    return token;
  }, []);

  const beginCancelOperation = useCallback((): number => {
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    operationInFlightRef.current = true;
    setIsCancelling(true);
    return token;
  }, []);

  const finishOperation = useCallback((token: number): boolean => {
    if (operationTokenRef.current !== token) {
      return false;
    }
    operationInFlightRef.current = false;
    if (mountedRef.current) {
      setIsCancelling(false);
    }
    return mountedRef.current;
  }, []);

  const invalidateOperation = useCallback(() => {
    operationTokenRef.current += 1;
    operationInFlightRef.current = false;
    if (mountedRef.current) {
      setIsCancelling(false);
    }
  }, []);

  const applyCurrentSnapshot = useCallback((snapshot: RunPollingSnapshot) => {
    if (!mountedRef.current) {
      return;
    }
    setRunView(currentRunView(snapshot.run, snapshot.events));
    setQueueStatus(snapshot.queueStatus);
  }, []);

  const loadQueueStatus = useCallback(async (runId: string): Promise<RunQueueStatus | null> => {
    try {
      return await client.getRunQueueStatus(runId);
    } catch {
      return null;
    }
  }, [client]);

  const loadSnapshot = useCallback(async (runId: string): Promise<RunPollingSnapshot> => {
    const [run, events, nextQueueStatus] = await Promise.all([
      client.getRun(runId),
      client.getRunEvents(runId),
      loadQueueStatus(runId),
    ]);
    return { run, events, queueStatus: nextQueueStatus };
  }, [client, loadQueueStatus]);

  /**
   * SSE 事件流跟踪：事件经 stream 增量到达，run 状态与队列状态低频轮询；
   * 返回 null 表示需要降级到轮询路径（环境不支持、连接失败或重连超限）。
   */
  const trackWithEventStream = useCallback(async ({
    initialEvents,
    initialQueueStatus,
    run,
    token,
  }: TrackWithStreamOptions): Promise<RunPollingResult | null> => {
    if (!isRunEventStreamSupported()) {
      return null;
    }

    const streamWait = wait ?? ((milliseconds: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)));
    let latestRun = run;
    let mergedEvents = initialEvents;
    let latestQueueStatus = initialQueueStatus;
    let fallbackRequested = false;
    let statusPolls = 0;
    let wakeResolver: (() => void) | null = null;

    const currentSnapshot = (): RunPollingSnapshot =>
      ({ run: latestRun, events: mergedEvents, queueStatus: latestQueueStatus });
    const cancelledResult = (): RunPollingResult =>
      ({ kind: "cancelled", attempts: statusPolls, snapshot: currentSnapshot() });
    const wake = () => {
      wakeResolver?.();
    };

    const streamHandle = openRunEventStream({
      url: client.runEventStreamUrl(run.id),
      fetchEventsAfter: (afterId) => client.eventsAfter(run.id, afterId),
      initialAfterId: maxRunEventId(initialEvents),
      onEvents: (incoming) => {
        mergedEvents = mergeRunEvents(mergedEvents, incoming);
        if (mountedRef.current) {
          setRunView(currentRunView(latestRun, mergedEvents));
        }
        // 收到终态事件时提前唤醒，立即拉取最终 run 状态
        if (incoming.some(isTerminalRunEvent)) {
          wake();
        }
      },
      onFallback: () => {
        fallbackRequested = true;
        wake();
      },
    });
    if (!streamHandle) {
      return null;
    }

    try {
      while (true) {
        if (!isOperationActive(token)) {
          return cancelledResult();
        }
        if (fallbackRequested) {
          return null;
        }

        // 低频状态轮询；终态事件或降级信号会提前唤醒
        await Promise.race([
          streamWait(streamStatusPollIntervalMs),
          new Promise<void>((resolve) => {
            wakeResolver = resolve;
          }),
        ]);
        wakeResolver = null;
        if (!isOperationActive(token)) {
          return cancelledResult();
        }
        if (fallbackRequested) {
          return null;
        }

        let nextRun: RunRecord;
        try {
          nextRun = await client.getRun(run.id);
        } catch {
          // run 状态拉取失败：交给轮询路径统一处理错误与重试
          return null;
        }
        latestQueueStatus = await loadQueueStatus(run.id);
        if (!isOperationActive(token)) {
          return cancelledResult();
        }
        if (fallbackRequested) {
          return null;
        }
        statusPolls += 1;
        latestRun = nextRun;
        if (mountedRef.current) {
          setRunView(currentRunView(latestRun, mergedEvents));
          setQueueStatus(latestQueueStatus);
        }
        if (isTerminalRunStatus(latestRun.status)) {
          return { kind: "terminal", attempts: statusPolls, snapshot: currentSnapshot() };
        }
      }
    } finally {
      // 组件卸载/run 切换/降级/终态都必须关闭 EventSource
      streamHandle.close();
    }
  }, [client, isOperationActive, loadQueueStatus, wait]);

  const trackCurrentRun = useCallback(async ({
    fetchImmediately = false,
    run,
    token,
  }: TrackCurrentRunOptions): Promise<RunPollingResult> => {
    const emptySnapshot: RunPollingSnapshot = { run, events: [], queueStatus: null };
    if (!isOperationActive(token)) {
      return { kind: "cancelled", attempts: 0, snapshot: emptySnapshot };
    }
    applyCurrentSnapshot(emptySnapshot);

    const [events, initialQueueStatus] = await Promise.all([
      client.getRunEvents(run.id),
      loadQueueStatus(run.id),
    ]);
    const initialSnapshot: RunPollingSnapshot = { run, events, queueStatus: initialQueueStatus };
    if (!isOperationActive(token)) {
      return { kind: "cancelled", attempts: 0, snapshot: emptySnapshot };
    }
    applyCurrentSnapshot(initialSnapshot);

    // 优先走 SSE 事件流；不可用或中途失败时回退轮询（轮询仍是一等路径）。
    // 初始事件已含终态事件说明 run 实际已结束（快速 run 常见）：此时 SSE 只会
    // 回放重复事件并在终态关流，重连没有任何收益，直接走轮询拉取最终状态
    const alreadyTerminatedByEvents = events.some(isTerminalRunEvent);
    if (!isTerminalRunStatus(run.status) && !alreadyTerminatedByEvents) {
      const streamResult = await trackWithEventStream({
        initialEvents: events,
        initialQueueStatus,
        run,
        token,
      });
      if (streamResult) {
        if (streamResult.kind === "terminal") {
          notifyRunTerminal(streamResult.snapshot.run);
        }
        return streamResult;
      }
      if (!isOperationActive(token)) {
        return { kind: "cancelled", attempts: 0, snapshot: emptySnapshot };
      }
    }

    const pollingResult = await pollRunUntilTerminal({
      initialSnapshot,
      loadSnapshot,
      isTerminal: (runRecord) => isTerminalRunStatus(runRecord.status),
      isActive: () => isOperationActive(token),
      onSnapshot: applyCurrentSnapshot,
      maxAttempts: maxPollAttempts,
      intervalMs: pollIntervalMs,
      // 事件已含终态时立即拉取最终状态，不再等一个轮询间隔
      fetchImmediately: fetchImmediately || alreadyTerminatedByEvents,
      wait,
    });
    if (pollingResult.kind === "terminal") {
      notifyRunTerminal(pollingResult.snapshot.run);
    }
    return pollingResult;
  }, [
    applyCurrentSnapshot,
    client,
    isOperationActive,
    loadQueueStatus,
    maxPollAttempts,
    pollIntervalMs,
    trackWithEventStream,
    wait,
  ]);

  const showHistoricalRun = useCallback((run: RunRecord, events: RunEvent[]) => {
    setRunView(historicalRunView(run, events));
    setQueueStatus(null);
  }, []);

  const resetRunState = useCallback(() => {
    invalidateOperation();
    setRunView(emptyRunView());
    setQueueStatus(null);
  }, [invalidateOperation]);

  return {
    beginCancelOperation,
    beginRunOperation,
    finishOperation,
    hasActiveOperation,
    invalidateOperation,
    isCancelling,
    isOperationActive,
    queueStatus,
    resetRunState,
    runView,
    showHistoricalRun,
    trackCurrentRun,
  };
}
