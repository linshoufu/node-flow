import type { RunEvent, RunQueueStatus, RunRecord } from "../types";

export type RunPollingSnapshot = {
  run: RunRecord;
  events: RunEvent[];
  queueStatus: RunQueueStatus | null;
};

export type RunPollingResult =
  | { kind: "terminal"; attempts: number; snapshot: RunPollingSnapshot }
  | { kind: "timeout"; attempts: number; snapshot: RunPollingSnapshot }
  | { kind: "cancelled"; attempts: number; snapshot: RunPollingSnapshot };

type PollRunUntilTerminalOptions = {
  initialSnapshot: RunPollingSnapshot;
  loadSnapshot: (runId: string) => Promise<RunPollingSnapshot>;
  isTerminal: (run: RunRecord) => boolean;
  isActive: () => boolean;
  onSnapshot: (snapshot: RunPollingSnapshot) => void;
  maxAttempts: number;
  intervalMs: number;
  fetchImmediately?: boolean;
  wait?: (milliseconds: number) => Promise<void>;
};

const defaultWait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export async function pollRunUntilTerminal({
  initialSnapshot,
  loadSnapshot,
  isTerminal,
  isActive,
  onSnapshot,
  maxAttempts,
  intervalMs,
  fetchImmediately = false,
  wait = defaultWait,
}: PollRunUntilTerminalOptions): Promise<RunPollingResult> {
  let snapshot = initialSnapshot;
  let attempts = 0;

  if (isTerminal(snapshot.run)) {
    return { kind: "terminal", attempts, snapshot };
  }

  while (attempts < maxAttempts) {
    if (!isActive()) {
      return { kind: "cancelled", attempts, snapshot };
    }

    if (!fetchImmediately || attempts > 0) {
      await wait(intervalMs);
      if (!isActive()) {
        return { kind: "cancelled", attempts, snapshot };
      }
    }

    const nextSnapshot = await loadSnapshot(snapshot.run.id);
    if (!isActive()) {
      return { kind: "cancelled", attempts, snapshot };
    }

    attempts += 1;
    snapshot = nextSnapshot;
    onSnapshot(snapshot);

    if (isTerminal(snapshot.run)) {
      return { kind: "terminal", attempts, snapshot };
    }
  }

  return { kind: "timeout", attempts, snapshot };
}
