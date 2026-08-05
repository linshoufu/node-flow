import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type WorkflowAutoSaveStatus =
  | "idle"
  | "scheduled"
  | "saving"
  | "retrying"
  | "conflict";

export type WorkflowAutoSaveResult =
  | { kind: "success"; pendingChanges?: boolean }
  | { kind: "busy" | "invalid" | "stale" }
  | { kind: "conflict" | "error"; error: unknown };

type UseWorkflowAutoSaveControllerOptions = {
  blocked: boolean;
  canSave: boolean;
  debounceMs?: number;
  dirty: boolean;
  documentKey: string;
  enabled: boolean;
  maxWaitMs?: number;
  onSave: () => Promise<WorkflowAutoSaveResult>;
  retryBaseMs?: number;
  retryMaxMs?: number;
  revision: number;
};

export type WorkflowAutoSaveController = {
  lastError: string | null;
  reset: () => void;
  retryCount: number;
  status: WorkflowAutoSaveStatus;
};

const DEFAULT_DEBOUNCE_MS = 2_000;
const DEFAULT_MAX_WAIT_MS = 10_000;
const DEFAULT_RETRY_BASE_MS = 2_000;
const DEFAULT_RETRY_MAX_MS = 30_000;

export function useWorkflowAutoSaveController({
  blocked,
  canSave,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  dirty,
  documentKey,
  enabled,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
  onSave,
  retryBaseMs = DEFAULT_RETRY_BASE_MS,
  retryMaxMs = DEFAULT_RETRY_MAX_MS,
  revision,
}: UseWorkflowAutoSaveControllerOptions): WorkflowAutoSaveController {
  const [status, setStatus] = useState<WorkflowAutoSaveStatus>("idle");
  const [retryCount, setRetryCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [scheduleRevision, setScheduleRevision] = useState(0);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const firstDirtyAtRef = useRef<number | null>(null);
  const retryAtRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const statusRef = useRef(status);
  const optionsRef = useRef({ blocked, canSave, dirty, enabled, onSave });
  statusRef.current = status;
  optionsRef.current = { blocked, canSave, dirty, enabled, onSave };

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    generationRef.current += 1;
    inFlightRef.current = false;
    firstDirtyAtRef.current = null;
    retryAtRef.current = null;
    statusRef.current = "idle";
    setStatus("idle");
    setRetryCount(0);
    setLastError(null);
    setScheduleRevision((current) => current + 1);
  }, [clearTimer]);

  useLayoutEffect(() => {
    reset();
  }, [documentKey, reset]);

  useEffect(() => {
    clearTimer();
    if (!enabled || !dirty || !canSave) {
      firstDirtyAtRef.current = null;
      retryAtRef.current = null;
      if (statusRef.current !== "conflict") {
        statusRef.current = "idle";
        setStatus("idle");
      }
      return;
    }
    if (blocked || inFlightRef.current || statusRef.current === "conflict") {
      return;
    }

    const now = Date.now();
    firstDirtyAtRef.current ??= now;
    const maxWaitRemaining = Math.max(0, maxWaitMs - (now - firstDirtyAtRef.current));
    const retryRemaining = retryAtRef.current === null
      ? null
      : Math.max(0, retryAtRef.current - now);
    const delay = retryRemaining ?? Math.min(debounceMs, maxWaitRemaining);
    const nextStatus = retryRemaining === null ? "scheduled" : "retrying";
    statusRef.current = nextStatus;
    setStatus(nextStatus);

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const latest = optionsRef.current;
      if (
        !latest.enabled
        || !latest.dirty
        || !latest.canSave
        || latest.blocked
        || inFlightRef.current
      ) {
        setScheduleRevision((current) => current + 1);
        return;
      }

      inFlightRef.current = true;
      const generation = generationRef.current;
      retryAtRef.current = null;
      statusRef.current = "saving";
      setStatus("saving");
      void latest.onSave().catch((error): WorkflowAutoSaveResult => ({
        kind: "error",
        error,
      })).then((result) => {
        if (generation !== generationRef.current) {
          return;
        }
        inFlightRef.current = false;
        if (result.kind === "success") {
          firstDirtyAtRef.current = result.pendingChanges ? Date.now() : null;
          setRetryCount(0);
          setLastError(null);
          statusRef.current = "idle";
          setStatus("idle");
          setScheduleRevision((current) => current + 1);
          return;
        }
        if (result.kind === "conflict") {
          setLastError(errorMessage(result.error));
          statusRef.current = "conflict";
          setStatus("conflict");
          return;
        }
        if (result.kind === "error") {
          setLastError(errorMessage(result.error));
          setRetryCount((current) => {
            const next = current + 1;
            retryAtRef.current = Date.now() + Math.min(
              retryMaxMs,
              retryBaseMs * 2 ** Math.max(0, next - 1),
            );
            return next;
          });
          statusRef.current = "retrying";
          setStatus("retrying");
          setScheduleRevision((current) => current + 1);
          return;
        }
        if (result.kind === "invalid") {
          firstDirtyAtRef.current = null;
          statusRef.current = "idle";
          setStatus("idle");
          return;
        }

        retryAtRef.current = Date.now() + 300;
        statusRef.current = "scheduled";
        setStatus("scheduled");
        setScheduleRevision((current) => current + 1);
      });
    }, delay);

    return clearTimer;
  }, [
    blocked,
    canSave,
    clearTimer,
    debounceMs,
    dirty,
    enabled,
    maxWaitMs,
    retryBaseMs,
    retryMaxMs,
    revision,
    scheduleRevision,
  ]);

  useEffect(() => clearTimer, [clearTimer]);

  return { lastError, reset, retryCount, status };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
