import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkflow } from "../lib/workflow";
import type { WorkflowPublicationStatus, WorkflowSummary } from "../types";
import {
  useWorkflowCatalogController,
  type WorkflowCatalogClient,
} from "./useWorkflowCatalogController";

function summary(id: string, name = id): WorkflowSummary {
  return { id, name, version: 1 };
}

function publication(workflowId: string, draftVersion: number): WorkflowPublicationStatus {
  return {
    workflow_id: workflowId,
    draft_version: draftVersion,
    published_version: null,
    active: false,
    has_unpublished_changes: false,
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

function client(overrides: Partial<WorkflowCatalogClient> = {}): WorkflowCatalogClient {
  return {
    getWorkflowPublication: vi.fn().mockResolvedValue(publication("wf-1", 1)),
    listWorkflows: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("useWorkflowCatalogController", () => {
  it("loads the catalog under the application StrictMode lifecycle", async () => {
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const executionClient = client({
      listWorkflows: vi.fn().mockResolvedValue([summary("wf-1")]),
    });
    const { result } = renderHook(
      () => useWorkflowCatalogController({ client: executionClient }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.workflows).toEqual([summary("wf-1")]));
    expect(result.current.isCatalogLoading).toBe(false);
  });

  it("ignores an older catalog refresh response", async () => {
    const initialRequest = deferred<WorkflowSummary[]>();
    const latestRequest = deferred<WorkflowSummary[]>();
    const executionClient = client({
      listWorkflows: vi.fn()
        .mockReturnValueOnce(initialRequest.promise)
        .mockReturnValueOnce(latestRequest.promise),
    });
    const { result } = renderHook(() => useWorkflowCatalogController({ client: executionClient }));

    let latestRefresh!: Promise<WorkflowSummary[] | null>;
    act(() => {
      latestRefresh = result.current.refreshCatalog();
    });
    latestRequest.resolve([summary("latest")]);
    await act(async () => latestRefresh);
    initialRequest.resolve([summary("stale")]);
    await act(async () => initialRequest.promise);

    expect(result.current.workflows).toEqual([summary("latest")]);
  });

  it("keeps publication state bound to the latest selected workflow", async () => {
    const firstRequest = deferred<WorkflowPublicationStatus>();
    const secondRequest = deferred<WorkflowPublicationStatus>();
    const executionClient = client({
      getWorkflowPublication: vi.fn()
        .mockReturnValueOnce(firstRequest.promise)
        .mockReturnValueOnce(secondRequest.promise),
    });
    const { result } = renderHook(() => useWorkflowCatalogController({ client: executionClient }));

    act(() => {
      void result.current.selectWorkflow("wf-first");
      void result.current.selectWorkflow("wf-second");
    });
    secondRequest.resolve(publication("wf-second", 2));
    await waitFor(() => expect(result.current.publication?.workflow_id).toBe("wf-second"));
    firstRequest.resolve(publication("wf-first", 1));
    await act(async () => firstRequest.promise);

    expect(result.current.selectedWorkflowId).toBe("wf-second");
    expect(result.current.publication?.workflow_id).toBe("wf-second");
    expect(result.current.isSelectedWorkflowCurrent("wf-first")).toBe(false);
  });

  it("invalidates older publication refreshes for the same workflow", async () => {
    const firstRequest = deferred<WorkflowPublicationStatus>();
    const secondRequest = deferred<WorkflowPublicationStatus>();
    const executionClient = client({
      getWorkflowPublication: vi.fn()
        .mockReturnValueOnce(firstRequest.promise)
        .mockReturnValueOnce(secondRequest.promise),
    });
    const { result } = renderHook(() => useWorkflowCatalogController({ client: executionClient }));
    act(() => {
      void result.current.selectWorkflow("wf-1");
    });
    act(() => {
      void result.current.refreshPublication("wf-1");
    });

    secondRequest.resolve(publication("wf-1", 2));
    await waitFor(() => expect(result.current.publication?.draft_version).toBe(2));
    firstRequest.resolve(publication("wf-1", 1));
    await act(async () => firstRequest.promise);
    expect(result.current.publication?.draft_version).toBe(2);
  });

  it("clears publication when the selection is cleared", async () => {
    const executionClient = client();
    const { result } = renderHook(() => useWorkflowCatalogController({ client: executionClient }));
    await act(async () => result.current.selectWorkflow("wf-1"));
    expect(result.current.publication).not.toBeNull();

    act(() => {
      void result.current.selectWorkflow("");
    });
    expect(result.current.selectedWorkflowId).toBe("");
    expect(result.current.publication).toBeNull();
  });

  it("upserts and removes summaries while preserving server-owned runtime metadata", async () => {
    const existing = {
      ...summary("wf-1", "Old"),
      last_run_status: "failed" as const,
      updated_at: "2026-08-01T00:00:00Z",
    };
    const executionClient = client({ listWorkflows: vi.fn().mockResolvedValue([existing]) });
    const { result } = renderHook(() => useWorkflowCatalogController({
      client: executionClient,
    }));
    await waitFor(() => {
      expect(result.current.workflows).toHaveLength(1);
      expect(result.current.isCatalogLoading).toBe(false);
    });

    act(() => result.current.upsertWorkflowSummary({
      ...createEmptyWorkflow(),
      id: "wf-1",
      name: "Updated",
      version: 2,
      nodes: [{
        id: "node-1",
        type: "trigger.manual",
        position: { x: 0, y: 0 },
        config: {},
      }],
    }));
    expect(result.current.workflows[0]).toMatchObject({
      id: "wf-1",
      name: "Updated",
      version: 2,
      node_count: 1,
      last_run_status: "failed",
      updated_at: "2026-08-01T00:00:00Z",
    });

    act(() => result.current.removeWorkflowSummary("wf-1"));
    expect(result.current.workflows).toEqual([]);
  });

  it("reports only the latest catalog loading error", async () => {
    const firstRequest = deferred<WorkflowSummary[]>();
    const executionClient = client({
      listWorkflows: vi.fn()
        .mockReturnValueOnce(firstRequest.promise)
        .mockRejectedValueOnce(new Error("catalog offline")),
    });
    const { result } = renderHook(() => useWorkflowCatalogController({ client: executionClient }));

    act(() => {
      void result.current.refreshCatalog();
    });
    await waitFor(() => {
      expect(result.current.catalogError).toBe("工作流列表加载失败：catalog offline");
      expect(result.current.isCatalogLoading).toBe(false);
    });
    await act(async () => {
      firstRequest.reject(new Error("stale error"));
      await Promise.resolve();
    });
    expect(result.current.catalogError).toBe("工作流列表加载失败：catalog offline");
  });
});
