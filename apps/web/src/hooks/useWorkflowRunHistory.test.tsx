import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import type { RunRecord } from "../types";
import {
  useWorkflowRunHistory,
  type WorkflowRunHistoryClient,
} from "./useWorkflowRunHistory";

function run(id: string, createdAt: string, status: RunRecord["status"] = "succeeded"): RunRecord {
  return {
    id,
    workflow_id: "wf_history",
    workflow_version: 1,
    status,
    created_at: createdAt,
    started_at: createdAt,
    completed_at: createdAt,
    error: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("useWorkflowRunHistory", () => {
  it("settles history loading under the application StrictMode lifecycle", async () => {
    const client: WorkflowRunHistoryClient = {
      listWorkflowRuns: vi.fn().mockResolvedValue([run("strict", "2026-08-01T01:00:00Z")]),
    };
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(
      () => useWorkflowRunHistory({ client, workflowId: "wf_history" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.runs[0]?.id).toBe("strict"));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("loads and appends deduplicated pages using the current offset", async () => {
    const firstPage = [run("run_2", "2026-08-01T02:00:00Z"), run("run_1", "2026-08-01T01:00:00Z")];
    const secondPage = [run("run_1", "2026-08-01T01:00:00Z"), run("run_0", "2026-08-01T00:00:00Z")];
    const client: WorkflowRunHistoryClient = {
      listWorkflowRuns: vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage),
    };
    const { result } = renderHook(() => useWorkflowRunHistory({ client, pageSize: 2, workflowId: "wf_history" }));

    await waitFor(() => expect(result.current.runs).toEqual(firstPage));
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.runs.map(({ id }) => id)).toEqual(["run_2", "run_1", "run_0"]));
    expect(client.listWorkflowRuns).toHaveBeenLastCalledWith("wf_history", 2, 2, undefined);
  });

  it("clears immediately on workflow change and ignores the stale response", async () => {
    const firstRequest = deferred<RunRecord[]>();
    const secondRequest = deferred<RunRecord[]>();
    const client: WorkflowRunHistoryClient = {
      listWorkflowRuns: vi.fn().mockReturnValueOnce(firstRequest.promise).mockReturnValueOnce(secondRequest.promise),
    };
    const { result, rerender } = renderHook(
      ({ workflowId }) => useWorkflowRunHistory({ client, workflowId }),
      { initialProps: { workflowId: "wf_first" } },
    );

    rerender({ workflowId: "wf_second" });
    expect(result.current.runs).toEqual([]);
    firstRequest.resolve([run("stale", "2026-08-01T00:00:00Z")]);
    await act(async () => firstRequest.promise);
    expect(result.current.runs).toEqual([]);
    secondRequest.resolve([run("current", "2026-08-01T01:00:00Z")]);
    await waitFor(() => expect(result.current.runs[0]?.id).toBe("current"));
  });

  it("invalidates an older request when the status filter changes", async () => {
    const allRequest = deferred<RunRecord[]>();
    const failedRequest = deferred<RunRecord[]>();
    const client: WorkflowRunHistoryClient = {
      listWorkflowRuns: vi.fn().mockReturnValueOnce(allRequest.promise).mockReturnValueOnce(failedRequest.promise),
    };
    const { result } = renderHook(() => useWorkflowRunHistory({ client, workflowId: "wf_history" }));
    act(() => result.current.changeStatusFilter("failed"));
    expect(result.current.statusFilter).toBe("failed");
    failedRequest.resolve([run("failed", "2026-08-01T01:00:00Z", "failed")]);
    await waitFor(() => expect(result.current.runs[0]?.id).toBe("failed"));
    allRequest.resolve([run("stale", "2026-08-01T02:00:00Z")]);
    await act(async () => allRequest.promise);
    expect(result.current.runs[0]?.id).toBe("failed");
    expect(client.listWorkflowRuns).toHaveBeenLastCalledWith("wf_history", 5, 0, "failed");
  });

  it("can preserve visible history when a background refresh fails", async () => {
    const client: WorkflowRunHistoryClient = {
      listWorkflowRuns: vi.fn()
        .mockResolvedValueOnce([run("existing", "2026-08-01T01:00:00Z")])
        .mockRejectedValueOnce(new Error("history offline")),
    };
    const { result } = renderHook(() => useWorkflowRunHistory({ client, workflowId: "wf_history" }));
    await waitFor(() => expect(result.current.runs).toHaveLength(1));
    await act(() => result.current.refresh({ preserveExistingOnError: true }));

    expect(result.current.runs[0]?.id).toBe("existing");
    expect(result.current.error).toBe("运行历史加载失败：history offline");
    expect(result.current.isLoading).toBe(false);
  });

  it("keeps an empty workflow idle without requesting history", async () => {
    const client: WorkflowRunHistoryClient = { listWorkflowRuns: vi.fn() };
    const { result } = renderHook(() => useWorkflowRunHistory({ client, workflowId: "" }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(client.listWorkflowRuns).not.toHaveBeenCalled();
    expect(result.current.runs).toEqual([]);
  });
});
