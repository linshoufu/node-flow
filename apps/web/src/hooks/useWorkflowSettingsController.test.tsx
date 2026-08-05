import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { createEmptyWorkflow } from "../lib/workflow";
import type { WorkflowDocument } from "../types";
import { useWorkflowSettingsController } from "./useWorkflowSettingsController";

function workflow(): WorkflowDocument {
  return {
    ...createEmptyWorkflow(),
    id: "workflow-1",
    name: "Original",
    description: "Old description",
    tags: ["API"],
    settings: {
      timeout_seconds: 600,
      variables: { token: "old", region: "east" },
      environment_id: "dev",
      error_workflow_id: "error-flow",
      max_concurrent_runs: 2,
    },
  };
}

function useHarness(initialWorkflow = workflow(), isEditorLocked = false) {
  const [currentWorkflow, setCurrentWorkflow] = useState(initialWorkflow);
  const controller = useWorkflowSettingsController({
    commitWorkflowChange: (updater) => setCurrentWorkflow((current) => updater(current)),
    isEditorLocked,
    workflowId: currentWorkflow.id,
  });
  return { ...controller, currentWorkflow, setCurrentWorkflow };
}

describe("useWorkflowSettingsController", () => {
  it("updates workflow metadata and ignores edits while locked", () => {
    const { result, rerender } = renderHook(
      ({ locked }) => useHarness(workflow(), locked),
      { initialProps: { locked: false } },
    );

    act(() => {
      result.current.updateWorkflowName("Updated");
      result.current.updateWorkflowDescription("New description");
    });
    expect(result.current.currentWorkflow.name).toBe("Updated");
    expect(result.current.currentWorkflow.description).toBe("New description");

    rerender({ locked: true });
    act(() => result.current.updateWorkflowName("Blocked"));
    expect(result.current.currentWorkflow.name).toBe("Updated");
  });

  it("trims and deduplicates tags, clears the input, and removes tags", () => {
    const { result } = renderHook(() => useHarness());

    act(() => result.current.setWorkflowTagInput("  Smoke  "));
    act(() => result.current.addWorkflowTag());
    expect(result.current.currentWorkflow.tags).toEqual(["API", "Smoke"]);
    expect(result.current.workflowTagInput).toBe("");

    act(() => result.current.setWorkflowTagInput("api"));
    act(() => result.current.addWorkflowTag());
    expect(result.current.currentWorkflow.tags).toEqual(["API", "Smoke"]);
    expect(result.current.workflowTagInput).toBe("");

    act(() => result.current.removeWorkflowTag("API"));
    expect(result.current.currentWorkflow.tags).toEqual(["Smoke"]);
  });

  it("clamps timeout values and ignores invalid timeout text", () => {
    const { result } = renderHook(() => useHarness());

    act(() => result.current.updateWorkflowTimeoutSeconds("0"));
    expect(result.current.currentWorkflow.settings?.timeout_seconds).toBe(1);
    act(() => result.current.updateWorkflowTimeoutSeconds("999999"));
    expect(result.current.currentWorkflow.settings?.timeout_seconds).toBe(86400);
    act(() => result.current.updateWorkflowTimeoutSeconds("not-a-number"));
    expect(result.current.currentWorkflow.settings?.timeout_seconds).toBe(86400);
  });

  it("updates concurrency without dropping other settings", () => {
    const { result } = renderHook(() => useHarness());

    act(() => result.current.updateWorkflowMaxConcurrentRuns("65"));
    expect(result.current.currentWorkflow.settings).toMatchObject({
      max_concurrent_runs: 65,
      environment_id: "dev",
      error_workflow_id: "error-flow",
      variables: { token: "old", region: "east" },
    });
    act(() => result.current.updateWorkflowMaxConcurrentRuns("2.5"));
    expect(result.current.currentWorkflow.settings?.max_concurrent_runs).toBe(65);
    act(() => result.current.updateWorkflowMaxConcurrentRuns(""));
    expect(result.current.currentWorkflow.settings?.max_concurrent_runs).toBeNull();
  });

  it("updates environment and error workflow while retaining settings", () => {
    const { result } = renderHook(() => useHarness());

    act(() => result.current.updateWorkflowEnvironment("staging"));
    act(() => result.current.updateErrorWorkflow(""));
    expect(result.current.currentWorkflow.settings).toEqual({
      timeout_seconds: 600,
      variables: { token: "old", region: "east" },
      environment_id: "staging",
      error_workflow_id: null,
      max_concurrent_runs: 2,
    });
  });

  it("manages variables without overwriting an existing variable on rename", () => {
    const { result } = renderHook(() => useHarness());

    act(() => result.current.addWorkflowVariable());
    expect(result.current.currentWorkflow.settings?.variables).toMatchObject({ variable_1: "" });
    act(() => result.current.updateWorkflowVariableValue("token", "new"));
    act(() => result.current.renameWorkflowVariable("region", "zone"));
    expect(result.current.currentWorkflow.settings?.variables).toMatchObject({
      token: "new",
      zone: "east",
    });

    act(() => result.current.renameWorkflowVariable("zone", "token"));
    expect(result.current.currentWorkflow.settings?.variables).toMatchObject({
      token: "new",
      zone: "east",
    });

    act(() => result.current.removeWorkflowVariable("variable_1"));
    expect(result.current.currentWorkflow.settings?.variables).not.toHaveProperty("variable_1");
  });

  it("clears an unfinished tag when switching workflows", () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.setWorkflowTagInput("unfinished"));
    act(() => result.current.setCurrentWorkflow((current) => ({ ...current, id: "workflow-2" })));
    expect(result.current.workflowTagInput).toBe("");
  });
});
