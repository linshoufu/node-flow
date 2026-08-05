import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkflow } from "../lib/workflow";
import type { WorkflowDocument, WorkflowUpgradePreview } from "../types";
import {
  useWorkflowMutationController,
  type WorkflowMutationClient,
} from "./useWorkflowMutationController";

function workflow(id: string, version = 1, name = id): WorkflowDocument {
  return { ...createEmptyWorkflow(), id, version, name };
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

function client(overrides: Partial<WorkflowMutationClient> = {}): WorkflowMutationClient {
  return {
    applyWorkflowUpgrades: vi.fn().mockResolvedValue(workflow("wf-1", 2)),
    previewWorkflowUpgrades: vi.fn().mockResolvedValue({ workflow: workflow("wf-1"), upgrades: [] }),
    restoreWorkflowVersion: vi.fn().mockResolvedValue(workflow("wf-1", 2)),
    rollbackWorkflowVersion: vi.fn().mockResolvedValue(workflow("wf-1", 2)),
    saveWorkflow: vi.fn().mockResolvedValue(workflow("wf-1", 2)),
    setWorkflowActive: vi.fn().mockResolvedValue({ ...workflow("wf-1"), active: true }),
    ...overrides,
  };
}

describe("useWorkflowMutationController", () => {
  it("serializes saves and forwards the expected workflow version", async () => {
    const pendingSave = deferred<WorkflowDocument>();
    const mutationClient = client({ saveWorkflow: vi.fn().mockReturnValue(pendingSave.promise) });
    const { result } = renderHook(() => useWorkflowMutationController({
      client: mutationClient,
      documentId: "wf-1",
    }));

    let firstSave!: ReturnType<typeof result.current.saveWorkflow>;
    let duplicateSave!: ReturnType<typeof result.current.saveWorkflow>;
    act(() => {
      firstSave = result.current.saveWorkflow(workflow("wf-1", 4), 4);
      duplicateSave = result.current.saveWorkflow(workflow("wf-1", 4), 4);
    });
    await expect(duplicateSave).resolves.toEqual({ kind: "busy" });
    expect(result.current.activeOperation).toBe("save");
    expect(mutationClient.saveWorkflow).toHaveBeenCalledTimes(1);
    expect(mutationClient.saveWorkflow).toHaveBeenCalledWith(expect.objectContaining({ version: 4 }), 4);

    pendingSave.resolve(workflow("wf-1", 5));
    await expect(firstSave).resolves.toMatchObject({ kind: "success", value: { version: 5 } });
    await waitFor(() => expect(result.current.activeOperation).toBeNull());
  });

  it("reports automatic save mode without changing document ownership", async () => {
    const pendingSave = deferred<WorkflowDocument>();
    const mutationClient = client({ saveWorkflow: vi.fn().mockReturnValue(pendingSave.promise) });
    const { result } = renderHook(() => useWorkflowMutationController({
      client: mutationClient,
      documentId: "wf-owner",
    }));

    let saveResult!: ReturnType<typeof result.current.saveWorkflow>;
    act(() => {
      saveResult = result.current.saveWorkflow(workflow("wf-copy"), undefined, "auto", "wf-owner");
    });
    expect(result.current.activeSaveMode).toBe("auto");
    pendingSave.resolve(workflow("wf-copy", 1));

    await expect(saveResult).resolves.toMatchObject({ kind: "success" });
    await waitFor(() => expect(result.current.activeSaveMode).toBeNull());
  });

  it("marks a response stale when another document replaces its owner", async () => {
    const pendingSave = deferred<WorkflowDocument>();
    const mutationClient = client({ saveWorkflow: vi.fn().mockReturnValue(pendingSave.promise) });
    const { result, rerender } = renderHook(
      ({ documentId }) => useWorkflowMutationController({ client: mutationClient, documentId }),
      { initialProps: { documentId: "wf-1" } },
    );

    let saveResult!: ReturnType<typeof result.current.saveWorkflow>;
    act(() => {
      saveResult = result.current.saveWorkflow(workflow("wf-1"), 1);
    });
    rerender({ documentId: "wf-2" });
    expect(result.current.activeOperation).toBeNull();
    pendingSave.resolve(workflow("wf-1", 2));

    await expect(saveResult).resolves.toEqual({ kind: "stale" });
  });

  it("returns request errors and releases the mutation lock", async () => {
    const mutationClient = client({
      setWorkflowActive: vi.fn().mockRejectedValue(new Error("publish offline")),
    });
    const { result } = renderHook(() => useWorkflowMutationController({
      client: mutationClient,
      documentId: "wf-1",
    }));

    await act(async () => {
      const mutation = await result.current.updateActivation("wf-1", true, 4);
      expect(mutation).toMatchObject({ kind: "error", error: new Error("publish offline") });
    });
    expect(mutationClient.setWorkflowActive).toHaveBeenCalledWith("wf-1", true, 4);
    expect(result.current.activeOperation).toBeNull();
  });

  it("owns the node upgrade preview and clears it after applying", async () => {
    const preview: WorkflowUpgradePreview = {
      workflow: workflow("wf-1", 1),
      upgrades: [{
        nodeId: "node-1",
        path: "nodes.node-1",
        nodeType: "test.node",
        fromVersion: 1,
        toVersion: 2,
        configChanges: [],
        migrationNotes: [],
      }],
    };
    const mutationClient = client({ previewWorkflowUpgrades: vi.fn().mockResolvedValue(preview) });
    const { result } = renderHook(() => useWorkflowMutationController({
      client: mutationClient,
      documentId: "wf-1",
    }));

    await act(async () => result.current.previewNodeUpgrades("wf-1"));
    expect(result.current.upgradePreview?.upgrades).toHaveLength(1);
    await act(async () => result.current.applyNodeUpgrades("wf-1", 1));
    expect(mutationClient.applyWorkflowUpgrades).toHaveBeenCalledWith("wf-1", 1);
    expect(result.current.upgradePreview).toBeNull();
  });

  it("clears an upgrade preview when the document changes", async () => {
    const preview: WorkflowUpgradePreview = {
      workflow: workflow("wf-1"),
      upgrades: [{
        nodeId: "node-1",
        path: "nodes.node-1",
        nodeType: "test.node",
        fromVersion: 1,
        toVersion: 2,
        configChanges: [],
        migrationNotes: [],
      }],
    };
    const mutationClient = client({ previewWorkflowUpgrades: vi.fn().mockResolvedValue(preview) });
    const { result, rerender } = renderHook(
      ({ documentId }) => useWorkflowMutationController({ client: mutationClient, documentId }),
      { initialProps: { documentId: "wf-1" } },
    );
    await act(async () => result.current.previewNodeUpgrades("wf-1"));
    expect(result.current.upgradePreview).not.toBeNull();

    rerender({ documentId: "wf-2" });
    expect(result.current.upgradePreview).toBeNull();
  });

  it("delegates restore and rollback through the same operation boundary", async () => {
    const mutationClient = client();
    const { result } = renderHook(() => useWorkflowMutationController({
      client: mutationClient,
      documentId: "wf-1",
    }));

    await act(async () => result.current.restoreVersion("wf-1", 2, 4));
    await act(async () => result.current.rollbackVersion("wf-1", 1, 5));

    expect(mutationClient.restoreWorkflowVersion).toHaveBeenCalledWith("wf-1", 2, 4);
    expect(mutationClient.rollbackWorkflowVersion).toHaveBeenCalledWith("wf-1", 1, 5);
  });
});
