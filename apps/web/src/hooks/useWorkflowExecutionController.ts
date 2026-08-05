import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { apiClient } from "../api/client";
import {
  pollRunUntilTerminal,
  type RunPollingResult,
  type RunPollingSnapshot,
} from "../lib/runPolling";
import {
  currentRunView,
  emptyRunView,
  historicalRunView,
  isTerminalRunStatus,
  type RunViewState,
} from "../lib/runView";
import type { RunEvent, RunQueueStatus, RunRecord } from "../types";

export type WorkflowExecutionClient = Pick<
  ApiClient,
  "getRun" | "getRunEvents" | "getRunQueueStatus"
>;

type UseWorkflowExecutionControllerOptions = {
  client?: WorkflowExecutionClient;
  maxPollAttempts?: number;
  pollIntervalMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
};

type TrackCurrentRunOptions = {
  fetchImmediately?: boolean;
  run: RunRecord;
  token: number;
};

const DEFAULT_MAX_POLL_ATTEMPTS = 120;
const DEFAULT_POLL_INTERVAL_MS = 1000;

export function useWorkflowExecutionController({
  client = apiClient,
  maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
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

    return pollRunUntilTerminal({
      initialSnapshot,
      loadSnapshot,
      isTerminal: (runRecord) => isTerminalRunStatus(runRecord.status),
      isActive: () => isOperationActive(token),
      onSnapshot: applyCurrentSnapshot,
      maxAttempts: maxPollAttempts,
      intervalMs: pollIntervalMs,
      fetchImmediately,
      wait,
    });
  }, [
    applyCurrentSnapshot,
    client,
    isOperationActive,
    loadQueueStatus,
    loadSnapshot,
    maxPollAttempts,
    pollIntervalMs,
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
