import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkflow } from "../lib/workflow";
import type {
  WorkflowDocument,
  WorkflowTriggerStatus,
  WorkflowVersionSummary,
} from "../types";
import {
  useWorkflowLifecycleController,
  type WorkflowLifecycleClient,
} from "./useWorkflowLifecycleController";

function workflow(id: string, version: number, name = id): WorkflowDocument {
  return { ...createEmptyWorkflow(), id, version, name };
}

function version(versionNumber: number): WorkflowVersionSummary {
  return {
    version: versionNumber,
    created_at: "2026-08-01T00:00:00Z",
    name: `Version ${versionNumber}`,
    active: false,
    node_count: 0,
    action: "save",
    source_version: null,
  };
}

function trigger(workflowId: string): WorkflowTriggerStatus {
  return {
    node_id: "trigger-1",
    type: "trigger.manual",
    active: true,
    details: { workflow_id: workflowId },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function client(overrides: Partial<WorkflowLifecycleClient> = {}): WorkflowLifecycleClient {
  return {
    getWorkflowVersion: vi.fn().mockResolvedValue(workflow("wf-1", 1)),
    listWorkflowTriggers: vi.fn().mockResolvedValue([]),
    listWorkflowVersions: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("useWorkflowLifecycleController", () => {
  it("opens and loads version history", async () => {
    const executionClient = client({
      listWorkflowVersions: vi.fn().mockResolvedValue([version(2), version(1)]),
    });
    const { result } = renderHook(() => useWorkflowLifecycleController({
      client: executionClient,
      currentWorkflow: workflow("wf-1", 2),
      workflowId: "wf-1",
    }));

    act(() => result.current.toggleVersions());
    expect(result.current.isVersionsOpen).toBe(true);
    await waitFor(() => expect(result.current.versions).toHaveLength(2));
    expect(result.current.isVersionsLoading).toBe(false);
  });

  it("ignores an older version list refresh", async () => {
    const firstRequest = deferred<WorkflowVersionSummary[]>();
    const secondRequest = deferred<WorkflowVersionSummary[]>();
    const executionClient = client({
      listWorkflowVersions: vi.fn()
        .mockReturnValueOnce(firstRequest.promise)
        .mockReturnValueOnce(secondRequest.promise),
    });
    const { result } = renderHook(() => useWorkflowLifecycleController({
      client: executionClient,
      currentWorkflow: workflow("wf-1", 2),
      workflowId: "wf-1",
    }));
    act(() => {
      void result.current.refreshVersions();
      void result.current.refreshVersions();
    });
    secondRequest.resolve([version(2)]);
    await waitFor(() => expect(result.current.versions).toEqual([version(2)]));
    firstRequest.resolve([version(1)]);
    await act(async () => firstRequest.promise);
    expect(result.current.versions).toEqual([version(2)]);
  });

  it("invalidates versions, triggers, diff, panels, and rollback target on workflow switch", async () => {
    const executionClient = client({
      listWorkflowTriggers: vi.fn().mockResolvedValue([trigger("wf-1")]),
      listWorkflowVersions: vi.fn().mockResolvedValue([version(1)]),
    });
    const { result, rerender } = renderHook(
      ({ currentWorkflow, workflowId }) => useWorkflowLifecycleController({
        client: executionClient,
        currentWorkflow,
        workflowId,
      }),
      { initialProps: { currentWorkflow: workflow("wf-1", 1), workflowId: "wf-1" } },
    );
    act(() => {
      result.current.toggleVersions();
      result.current.toggleTriggers();
      result.current.setRollbackTargetVersion(1);
    });
    await waitFor(() => expect(result.current.triggers).toHaveLength(1));

    rerender({ currentWorkflow: workflow("wf-2", 1), workflowId: "wf-2" });
    expect(result.current.versions).toEqual([]);
    expect(result.current.triggers).toEqual([]);
    expect(result.current.versionDiff).toBeNull();
    expect(result.current.isVersionsOpen).toBe(false);
    expect(result.current.isTriggersOpen).toBe(false);
    expect(result.current.rollbackTargetVersion).toBeNull();
  });

  it("ignores a trigger response from the previous workflow", async () => {
    const firstRequest = deferred<WorkflowTriggerStatus[]>();
    const executionClient = client({
      listWorkflowTriggers: vi.fn()
        .mockReturnValueOnce(firstRequest.promise)
        .mockResolvedValueOnce([trigger("wf-2")]),
    });
    const { result, rerender } = renderHook(
      ({ currentWorkflow, workflowId }) => useWorkflowLifecycleController({
        client: executionClient,
        currentWorkflow,
        workflowId,
      }),
      { initialProps: { currentWorkflow: workflow("wf-1", 1), workflowId: "wf-1" } },
    );
    act(() => {
      void result.current.refreshTriggers();
    });
    rerender({ currentWorkflow: workflow("wf-2", 1), workflowId: "wf-2" });
    await act(async () => result.current.refreshTriggers());
    firstRequest.resolve([trigger("wf-1")]);
    await act(async () => firstRequest.promise);
    expect(result.current.triggers).toEqual([trigger("wf-2")]);
  });

  it("builds a version diff and ignores a superseded comparison", async () => {
    const oldRequest = deferred<WorkflowDocument>();
    const latestRequest = deferred<WorkflowDocument>();
    const executionClient = client({
      getWorkflowVersion: vi.fn()
        .mockReturnValueOnce(oldRequest.promise)
        .mockReturnValueOnce(latestRequest.promise),
    });
    const currentWorkflow = workflow("wf-1", 3, "Current");
    const { result } = renderHook(() => useWorkflowLifecycleController({
      client: executionClient,
      currentWorkflow,
      workflowId: "wf-1",
    }));
    act(() => {
      void result.current.compareVersion(1);
      void result.current.compareVersion(2);
    });
    latestRequest.resolve(workflow("wf-1", 2, "Latest comparison"));
    await waitFor(() => expect(result.current.versionDiff).not.toBeNull());
    oldRequest.resolve(workflow("wf-1", 1, "Stale comparison"));
    await act(async () => oldRequest.promise);
    expect(result.current.versionDiff?.baselineVersion).toBe(2);
    expect(result.current.versionDiff?.currentVersion).toBe(3);
  });

  it("reports version, trigger, and diff loading errors", async () => {
    const executionClient = client({
      getWorkflowVersion: vi.fn().mockRejectedValue(new Error("diff offline")),
      listWorkflowTriggers: vi.fn().mockRejectedValue(new Error("triggers offline")),
      listWorkflowVersions: vi.fn().mockRejectedValue(new Error("versions offline")),
    });
    const { result } = renderHook(() => useWorkflowLifecycleController({
      client: executionClient,
      currentWorkflow: workflow("wf-1", 2),
      workflowId: "wf-1",
    }));

    await act(async () => {
      await Promise.all([
        result.current.refreshVersions(),
        result.current.refreshTriggers(),
        result.current.compareVersion(1),
      ]);
    });
    expect(result.current.versionsError).toBe("版本历史加载失败：versions offline");
    expect(result.current.triggersError).toBe("触发器状态加载失败：triggers offline");
    expect(result.current.versionDiffError).toBe("版本差异加载失败：diff offline");
  });
});
