import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkflow } from "../lib/workflow";
import type { RunEvent, RunRecord, WorkflowDocument } from "../types";
import {
  useRunInspectorController,
  type RunInspectorClient,
} from "./useRunInspectorController";

function workflow(id = "workflow-1", version = 1, name = `Workflow v${version}`): WorkflowDocument {
  return {
    ...createEmptyWorkflow(),
    id,
    version,
    name,
    nodes: [{
      id: "node-1",
      type: "test.node",
      typeVersion: 1,
      position: { x: 10, y: 20 },
      config: {},
    }],
  };
}

function run(
  id = "run-1",
  workflowId = "workflow-1",
  workflowVersion = 1,
): RunRecord {
  return {
    id,
    workflow_id: workflowId,
    workflow_version: workflowVersion,
    status: "succeeded",
    created_at: "2026-08-01T00:00:00Z",
    started_at: "2026-08-01T00:00:01Z",
    completed_at: "2026-08-01T00:00:02Z",
    error: null,
  };
}

function event(runId: string, type = "node_succeeded"): RunEvent {
  return {
    run_id: runId,
    type,
    timestamp: "2026-08-01T00:00:01Z",
    node_id: "node-1",
    scope: [],
    payload: {},
  };
}

function client(overrides: Partial<RunInspectorClient> = {}): RunInspectorClient {
  return {
    getRun: vi.fn().mockResolvedValue(run()),
    getRunEvents: vi.fn().mockResolvedValue([event("run-1")]),
    getWorkflowVersion: vi.fn().mockResolvedValue(workflow()),
    ...overrides,
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

describe("useRunInspectorController", () => {
  it("uses a cached run and current workflow version when both still match", async () => {
    const cachedRun = run();
    const inspectorClient = client();
    const { result } = renderHook(() => useRunInspectorController({
      client: inspectorClient,
      currentWorkflow: workflow(),
      recentRuns: [cachedRun],
    }));

    let loadResult!: Awaited<ReturnType<typeof result.current.loadHistoricalRun>>;
    await act(async () => {
      loadResult = await result.current.loadHistoricalRun("run-1", { nodeId: "node-1" });
    });

    expect(loadResult).toMatchObject({
      kind: "success",
      run: cachedRun,
      selectedNodeId: "node-1",
    });
    expect(inspectorClient.getRun).not.toHaveBeenCalled();
    expect(inspectorClient.getWorkflowVersion).not.toHaveBeenCalled();
    expect(result.current.historicalRunWorkflow).toBeNull();
  });

  it("rejects a run that belongs to another expected workflow before loading events", async () => {
    const inspectorClient = client({ getRun: vi.fn().mockResolvedValue(run("run-2", "workflow-2")) });
    const { result } = renderHook(() => useRunInspectorController({
      client: inspectorClient,
      currentWorkflow: workflow(),
      recentRuns: [],
    }));

    let loadResult!: Awaited<ReturnType<typeof result.current.loadHistoricalRun>>;
    await act(async () => {
      loadResult = await result.current.loadHistoricalRun("run-2", {
        expectedWorkflowId: "workflow-1",
      });
    });

    expect(loadResult).toEqual({ kind: "mismatch" });
    expect(inspectorClient.getRunEvents).not.toHaveBeenCalled();
    expect(result.current.isHistoricalRunLoading).toBe(false);
  });

  it("keeps the latest historical run when an older request finishes later", async () => {
    const firstRun = deferred<RunRecord>();
    const inspectorClient = client({
      getRun: vi.fn((runId: string) => (
        runId === "run-old" ? firstRun.promise : Promise.resolve(run("run-new", "workflow-1", 2))
      )),
      getRunEvents: vi.fn((runId: string) => Promise.resolve([event(runId)])),
      getWorkflowVersion: vi.fn((_workflowId: string, version: number) =>
        Promise.resolve(workflow("workflow-1", version, version === 2 ? "Latest" : "Stale"))),
    });
    const { result } = renderHook(() => useRunInspectorController({
      client: inspectorClient,
      currentWorkflow: workflow("workflow-1", 3),
      recentRuns: [],
    }));

    let oldPromise!: ReturnType<typeof result.current.loadHistoricalRun>;
    act(() => {
      oldPromise = result.current.loadHistoricalRun("run-old");
    });
    await act(async () => result.current.loadHistoricalRun("run-new"));
    expect(result.current.historicalRunWorkflow?.name).toBe("Latest");

    firstRun.resolve(run("run-old", "workflow-1", 1));
    await act(async () => oldPromise);
    expect(result.current.historicalRunWorkflow?.name).toBe("Latest");
  });

  it("loads the immutable run version if the current workflow changes during event loading", async () => {
    const eventsRequest = deferred<RunEvent[]>();
    const getWorkflowVersion = vi.fn().mockResolvedValue(workflow("workflow-1", 1, "Executed v1"));
    const inspectorClient = client({
      getRunEvents: vi.fn().mockReturnValue(eventsRequest.promise),
      getWorkflowVersion,
    });
    const { result, rerender } = renderHook(
      ({ currentWorkflow }) => useRunInspectorController({
        client: inspectorClient,
        currentWorkflow,
        recentRuns: [run()],
      }),
      { initialProps: { currentWorkflow: workflow("workflow-1", 1) } },
    );

    let loadPromise!: ReturnType<typeof result.current.loadHistoricalRun>;
    act(() => {
      loadPromise = result.current.loadHistoricalRun("run-1");
    });
    rerender({ currentWorkflow: workflow("workflow-1", 2) });
    eventsRequest.resolve([event("run-1")]);
    await act(async () => loadPromise);

    expect(getWorkflowVersion).toHaveBeenCalledWith("workflow-1", 1);
    expect(result.current.historicalRunWorkflow?.name).toBe("Executed v1");
  });

  it("ignores a slower comparison after another run is selected", async () => {
    const firstEvents = deferred<RunEvent[]>();
    const inspectorClient = client({
      getRunEvents: vi.fn((runId: string) => (
        runId === "run-1" ? firstEvents.promise : Promise.resolve([event("run-2")])
      )),
    });
    const { result } = renderHook(() => useRunInspectorController({
      client: inspectorClient,
      currentWorkflow: workflow(),
      recentRuns: [run("run-1"), run("run-2")],
    }));

    let firstPromise!: ReturnType<typeof result.current.loadComparisonRun>;
    act(() => {
      firstPromise = result.current.loadComparisonRun("run-1");
    });
    await act(async () => result.current.loadComparisonRun("run-2"));
    expect(result.current.comparisonRun?.id).toBe("run-2");
    expect(result.current.comparisonEvents).toEqual([event("run-2")]);

    firstEvents.resolve([event("run-1")]);
    await act(async () => firstPromise);
    expect(result.current.comparisonRun?.id).toBe("run-2");
    expect(result.current.comparisonEvents).toEqual([event("run-2")]);
  });

  it("invalidates pending inspector requests when reset", async () => {
    const runRequest = deferred<RunRecord>();
    const inspectorClient = client({ getRun: vi.fn().mockReturnValue(runRequest.promise) });
    const { result } = renderHook(() => useRunInspectorController({
      client: inspectorClient,
      currentWorkflow: workflow(),
      recentRuns: [],
    }));

    let loadPromise!: ReturnType<typeof result.current.loadHistoricalRun>;
    act(() => {
      loadPromise = result.current.loadHistoricalRun("run-1");
    });
    await waitFor(() => expect(result.current.isHistoricalRunLoading).toBe(true));
    act(() => result.current.resetRunInspector());
    expect(result.current.isHistoricalRunLoading).toBe(false);

    runRequest.resolve(run());
    await act(async () => loadPromise);
    expect(result.current.historicalRunWorkflow).toBeNull();
  });
});
