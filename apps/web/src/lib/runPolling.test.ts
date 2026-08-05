import { describe, expect, it, vi } from "vitest";
import type { RunRecord } from "../types";
import {
  pollRunUntilTerminal,
  type RunPollingSnapshot,
} from "./runPolling";

function run(status: RunRecord["status"]): RunRecord {
  return {
    id: "run-1",
    workflow_id: "workflow-1",
    workflow_version: 1,
    status,
    created_at: "2026-08-01T00:00:00Z",
    started_at: null,
    completed_at: null,
    error: null,
  };
}

function snapshot(status: RunRecord["status"]): RunPollingSnapshot {
  return {
    run: run(status),
    events: [],
    queueStatus: null,
  };
}

const isTerminal = (record: RunRecord) =>
  record.status === "succeeded" || record.status === "failed" || record.status === "cancelled";

describe("pollRunUntilTerminal", () => {
  it("returns an initial terminal run without polling", async () => {
    const loadSnapshot = vi.fn();
    const onSnapshot = vi.fn();

    const result = await pollRunUntilTerminal({
      initialSnapshot: snapshot("succeeded"),
      loadSnapshot,
      isTerminal,
      isActive: () => true,
      onSnapshot,
      maxAttempts: 3,
      intervalMs: 1000,
    });

    expect(result.kind).toBe("terminal");
    expect(result.attempts).toBe(0);
    expect(loadSnapshot).not.toHaveBeenCalled();
    expect(onSnapshot).not.toHaveBeenCalled();
  });

  it("waits before polling and publishes the terminal snapshot", async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const terminalSnapshot = snapshot("succeeded");
    const loadSnapshot = vi.fn().mockResolvedValue(terminalSnapshot);
    const onSnapshot = vi.fn();

    const result = await pollRunUntilTerminal({
      initialSnapshot: snapshot("running"),
      loadSnapshot,
      isTerminal,
      isActive: () => true,
      onSnapshot,
      maxAttempts: 3,
      intervalMs: 800,
      wait,
    });

    expect(wait).toHaveBeenCalledWith(800);
    expect(loadSnapshot).toHaveBeenCalledWith("run-1");
    expect(onSnapshot).toHaveBeenCalledWith(terminalSnapshot);
    expect(result).toEqual({ kind: "terminal", attempts: 1, snapshot: terminalSnapshot });
  });

  it("can fetch the first snapshot immediately", async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const loadSnapshot = vi.fn().mockResolvedValue(snapshot("cancelled"));

    await pollRunUntilTerminal({
      initialSnapshot: snapshot("running"),
      loadSnapshot,
      isTerminal,
      isActive: () => true,
      onSnapshot: vi.fn(),
      maxAttempts: 3,
      intervalMs: 1000,
      fetchImmediately: true,
      wait,
    });

    expect(loadSnapshot).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  it("returns a timeout after the exact maximum number of attempts", async () => {
    const loadSnapshot = vi.fn().mockResolvedValue(snapshot("running"));
    const onSnapshot = vi.fn();

    const result = await pollRunUntilTerminal({
      initialSnapshot: snapshot("queued"),
      loadSnapshot,
      isTerminal,
      isActive: () => true,
      onSnapshot,
      maxAttempts: 2,
      intervalMs: 0,
      wait: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.kind).toBe("timeout");
    expect(result.attempts).toBe(2);
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
    expect(onSnapshot).toHaveBeenCalledTimes(2);
  });

  it("stops before fetching when the polling owner is inactive", async () => {
    const loadSnapshot = vi.fn();

    const result = await pollRunUntilTerminal({
      initialSnapshot: snapshot("running"),
      loadSnapshot,
      isTerminal,
      isActive: () => false,
      onSnapshot: vi.fn(),
      maxAttempts: 2,
      intervalMs: 0,
    });

    expect(result.kind).toBe("cancelled");
    expect(loadSnapshot).not.toHaveBeenCalled();
  });

  it("does not publish a fetched snapshot after the owner becomes inactive", async () => {
    let active = true;
    const onSnapshot = vi.fn();
    const loadSnapshot = vi.fn(async () => {
      active = false;
      return snapshot("succeeded");
    });
    const initialSnapshot = snapshot("running");

    const result = await pollRunUntilTerminal({
      initialSnapshot,
      loadSnapshot,
      isTerminal,
      isActive: () => active,
      onSnapshot,
      maxAttempts: 2,
      intervalMs: 0,
      fetchImmediately: true,
    });

    expect(result).toEqual({ kind: "cancelled", attempts: 0, snapshot: initialSnapshot });
    expect(onSnapshot).not.toHaveBeenCalled();
  });

  it("propagates polling request failures", async () => {
    const requestError = new Error("network unavailable");

    await expect(
      pollRunUntilTerminal({
        initialSnapshot: snapshot("running"),
        loadSnapshot: vi.fn().mockRejectedValue(requestError),
        isTerminal,
        isActive: () => true,
        onSnapshot: vi.fn(),
        maxAttempts: 2,
        intervalMs: 0,
        fetchImmediately: true,
      })
    ).rejects.toBe(requestError);
  });
});
