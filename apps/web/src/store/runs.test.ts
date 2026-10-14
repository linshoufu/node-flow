import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/api/client";
import type { RunEvent, RunRecord, WorkflowDocument } from "@/types";
import { useRunsStore } from "./runs";

const run = (id = "run-first", version = 3): RunRecord => ({ id, workflow_id: "wf", workflow_version: version,
  status: "succeeded", created_at: "2026-10-15T00:00:00Z", started_at: null, completed_at: null, error: null });
const document = (version = 3): WorkflowDocument => ({ id: "wf", name: "Historical workflow", version, nodes: [], edges: [] });
const event = (id: string): RunEvent => ({ id: 1, run_id: id, type: "node_succeeded", timestamp: "2026-10-15T00:00:00Z", scope: [], payload: { outputs: { result: id } } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };

describe("execution browsing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useRunsStore.getState().setWorkflow("");
    useRunsStore.setState({ workflowId: "wf" });
    vi.spyOn(apiClient, "listWorkflowRuns").mockResolvedValue([]);
    vi.spyOn(apiClient, "getRun").mockImplementation(async (id) => run(id));
    vi.spyOn(apiClient, "getRunEvents").mockImplementation(async (id) => [event(id)]);
    vi.spyOn(apiClient, "getWorkflowVersion").mockImplementation(async (_, version) => document(version));
  });

  it("uses the version recorded by the execution", async () => {
    await useRunsStore.getState().selectRun(run());
    expect(apiClient.getWorkflowVersion).toHaveBeenCalledWith("wf", 3);
    expect(useRunsStore.getState().document?.version).toBe(3);
    await useRunsStore.getState().refreshDetail();
    expect(apiClient.getWorkflowVersion).toHaveBeenCalledTimes(1);
  });

  it("does not substitute an editable workflow when a snapshot is unavailable", async () => {
    vi.mocked(apiClient.getWorkflowVersion).mockRejectedValue(new Error("missing version"));
    await useRunsStore.getState().selectRun(run());
    expect(useRunsStore.getState().document).toBeNull();
    expect(useRunsStore.getState().documentError).toContain("运行时");
    expect(useRunsStore.getState().events).toEqual([event("run-first")]);
  });

  it("ignores late events from a previously selected run", async () => {
    const older = deferred<RunEvent[]>();
    vi.mocked(apiClient.getRunEvents).mockImplementation(async (id) => id === "run-first" ? older.promise : [event(id)]);
    const first = useRunsStore.getState().selectRun(run());
    await Promise.resolve();
    await useRunsStore.getState().selectRun(run("run-second"));
    older.resolve([event("run-first")]);
    await first;
    expect(useRunsStore.getState().activeRun?.id).toBe("run-second");
    expect(useRunsStore.getState().events).toEqual([event("run-second")]);
  });

  it("clears the previous workflow even while its detail request is in flight", async () => {
    const pending = deferred<RunEvent[]>();
    vi.mocked(apiClient.getRunEvents).mockReturnValue(pending.promise);
    const first = useRunsStore.getState().selectRun(run());
    useRunsStore.getState().setWorkflow("another-workflow");
    pending.resolve([event("run-first")]);
    await first;
    expect(useRunsStore.getState().activeRun).toBeNull();
    expect(useRunsStore.getState().events).toEqual([]);
    expect(useRunsStore.getState().document).toBeNull();
  });

  it("pages and filters on the server, keeping the extra row out of the visible list", async () => {
    const records = Array.from({ length: 21 }, (_, index) => ({ ...run(`run-${index}`), status: "failed" as const }));
    vi.mocked(apiClient.listWorkflowRuns).mockResolvedValue(records);
    useRunsStore.getState().setStatus("failed");
    await useRunsStore.getState().refresh();
    expect(useRunsStore.getState().runs).toHaveLength(20);
    expect(useRunsStore.getState().hasMore).toBe(true);
    useRunsStore.getState().setPage(1);
    await useRunsStore.getState().refresh();
    expect(apiClient.listWorkflowRuns).toHaveBeenLastCalledWith("wf", 21, 20, "failed");
  });

  it("keeps the selected execution during a background history refresh", async () => {
    await useRunsStore.getState().selectRun(run());
    vi.mocked(apiClient.listWorkflowRuns).mockResolvedValue([run("run-newer"), run()]);
    await useRunsStore.getState().refresh();
    expect(useRunsStore.getState().activeRun?.id).toBe("run-first");
    expect(useRunsStore.getState().events).toEqual([event("run-first")]);
  });

  it("keeps a detail failure visible when a concurrent history refresh succeeds", async () => {
    vi.mocked(apiClient.getRun).mockRejectedValue(new Error("detail unavailable"));
    await useRunsStore.getState().selectRun(run());
    await useRunsStore.getState().refresh();
    expect(useRunsStore.getState().detailError).toContain("运行详情");
    expect(useRunsStore.getState().loadingDetail).toBe(false);
  });
});
