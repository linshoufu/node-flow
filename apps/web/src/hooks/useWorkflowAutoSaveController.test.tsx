import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useWorkflowAutoSaveController,
  type WorkflowAutoSaveResult,
} from "./useWorkflowAutoSaveController";

afterEach(() => {
  vi.useRealTimers();
});

describe("useWorkflowAutoSaveController", () => {
  it("debounces a dirty document and saves it once", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue({ kind: "success" });
    const { result, rerender } = renderHook(
      (props) => useWorkflowAutoSaveController({
        blocked: false,
        canSave: true,
        debounceMs: 2_000,
        dirty: props.dirty,
        documentKey: "wf-1",
        enabled: true,
        onSave,
        revision: 1,
      }),
      { initialProps: { dirty: true } },
    );

    expect(result.current.status).toBe("scheduled");
    await act(async () => vi.advanceTimersByTimeAsync(1_999));
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(onSave).toHaveBeenCalledTimes(1);
    rerender({ dirty: false });
    expect(result.current.status).toBe("idle");
  });

  it("queues another save when changes were made during the request", async () => {
    vi.useFakeTimers();
    const onSave = vi
      .fn()
      .mockResolvedValueOnce({ kind: "success", pendingChanges: true })
      .mockResolvedValueOnce({ kind: "success" });
    const { result } = renderHook(() => useWorkflowAutoSaveController({
      blocked: false,
      canSave: true,
      debounceMs: 500,
      dirty: true,
      documentKey: "wf-1",
      enabled: true,
      onSave,
      revision: 2,
    }));

    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("scheduled");
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("retries ordinary failures with exponential backoff", async () => {
    vi.useFakeTimers();
    const onSave = vi
      .fn()
      .mockResolvedValueOnce({ kind: "error", error: new Error("offline") })
      .mockResolvedValueOnce({ kind: "success" });
    const { result } = renderHook(() => useWorkflowAutoSaveController({
      blocked: false,
      canSave: true,
      debounceMs: 100,
      dirty: true,
      documentKey: "wf-1",
      enabled: true,
      onSave,
      retryBaseMs: 2_000,
      revision: 1,
    }));

    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(result.current.status).toBe("retrying");
    expect(result.current.retryCount).toBe(1);
    expect(result.current.lastError).toBe("offline");
    await act(async () => vi.advanceTimersByTimeAsync(1_999));
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("stops retrying conflicts until the controller is reset", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue({
      kind: "conflict",
      error: new Error("conflict"),
    });
    const { result, rerender } = renderHook(
      (props) => useWorkflowAutoSaveController({
        blocked: false,
        canSave: true,
        debounceMs: 100,
        dirty: props.dirty,
        documentKey: "wf-1",
        enabled: true,
        onSave,
        revision: 1,
      }),
      { initialProps: { dirty: true } },
    );

    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(result.current.status).toBe("conflict");
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(onSave).toHaveBeenCalledTimes(1);
    rerender({ dirty: false });
    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
  });

  it("ignores a completed save after another document replaces its owner", async () => {
    vi.useFakeTimers();
    const pendingSave = deferred<WorkflowAutoSaveResult>();
    const onSave = vi.fn().mockReturnValue(pendingSave.promise);
    const { result, rerender } = renderHook(
      (props) => useWorkflowAutoSaveController({
        blocked: false,
        canSave: true,
        debounceMs: 100,
        dirty: props.dirty,
        documentKey: props.documentKey,
        enabled: true,
        onSave,
        revision: props.revision,
      }),
      { initialProps: { dirty: true, documentKey: "wf-1", revision: 1 } },
    );
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(result.current.status).toBe("saving");

    rerender({ dirty: false, documentKey: "wf-2", revision: 0 });
    pendingSave.resolve({ kind: "conflict", error: new Error("old conflict") });
    await act(async () => Promise.resolve());

    expect(result.current.status).toBe("idle");
    expect(result.current.lastError).toBeNull();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
