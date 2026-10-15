import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeTemplate, WorkflowDocument } from "@/types";
import { apiClient } from "@/api/client";
import { useWorkflowStore } from "@/store/workflow";
import { beginLibraryEdit, editedTemplateDraft, finishLibraryEdit } from "./libraryEditing";

const original: WorkflowDocument = { id: "original", name: "Unsaved workflow", version: 9, settings: { timeout_seconds: 600, run_mode: "preview" }, nodes: [{ id: "n", type: "data.compose", position: { x: 4, y: 5 }, config: { output: "'original draft'" } }], edges: [] };
const preset: NodeTemplate = { id: "user_preset", source: "user", revision: 3, kind: "node", name: "Mine", packageId: "user", packageVersion: "1", node: { id: "saved", type: "data.compose", position: { x: 0, y: 0 }, config: { output: "'saved'" } } };
const before = useWorkflowStore.getState();
beforeEach(() => useWorkflowStore.setState({ workflow: structuredClone(original), selectedNodeId: "n", canvasScope: [], isDirty: true, isSaving: false, libraryEdit: null, saveError: null }));
afterEach(() => { vi.restoreAllMocks(); useWorkflowStore.setState(before, true); });

describe("isolated personal-resource editing", () => {
  it("edits an independent snapshot then restores the exact unsaved workflow, selection and dirty state", () => {
    const backup = useWorkflowStore.getState().workflow;
    beginLibraryEdit(preset);
    useWorkflowStore.getState().updateNodeConfig("saved", "output", "'edited'");
    expect(editedTemplateDraft().node?.config.output).toBe("'edited'");
    expect(preset.node?.config.output).toBe("'saved'");
    expect(backup.nodes[0].config.output).toBe("'original draft'");
    finishLibraryEdit();
    expect(useWorkflowStore.getState().workflow).toBe(backup);
    expect(useWorkflowStore.getState().selectedNodeId).toBe("n");
    expect(useWorkflowStore.getState().isDirty).toBe(true);
    expect(useWorkflowStore.getState().libraryEdit).toBeNull();
  });
  it("blocks execution and workflow saves while a resource draft is open", async () => {
    const run = vi.spyOn(apiClient, "createRun");
    const save = vi.spyOn(apiClient, "saveWorkflow");
    const load = vi.spyOn(apiClient, "getWorkflow");
    beginLibraryEdit(preset);
    expect(await useWorkflowStore.getState().runWorkflow()).toBeNull();
    await expect(useWorkflowStore.getState().saveWorkflow()).rejects.toThrow("节点库");
    await expect(useWorkflowStore.getState().selectWorkflow("other")).rejects.toThrow("结束");
    expect(run).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
  it("keeps loop edits scoped to their body and retains required parameter declarations", () => {
    const loop: NodeTemplate = { ...preset, kind: "subflow", node: undefined, graph: { nodes: [{ id: "child", type: "data.compose", position: { x: 0, y: 0 }, config: { output: "{{ run_parameters.file }}" } }], edges: [] }, parameters: [{ name: "file", type: "string" }] };
    beginLibraryEdit(loop);
    useWorkflowStore.getState().updateNodeLabel("child", "Edited child");
    const result = editedTemplateDraft();
    expect(result.graph?.nodes[0].label).toBe("Edited child");
    expect(result.parameters?.[0].name).toBe("file");
    expect(result.graph?.nodes.some((node) => node.type === "workflow.parameters")).toBe(false);
    finishLibraryEdit();
  });
  it("rejects package editing and prevents silently discarding extra root nodes from a preset", () => {
    expect(() => beginLibraryEdit({ ...preset, source: "package" })).toThrow("个人资源");
    expect(useWorkflowStore.getState().workflow).toEqual(original);
    beginLibraryEdit(preset);
    const current = useWorkflowStore.getState().workflow;
    useWorkflowStore.setState({ workflow: { ...current, nodes: [...current.nodes, original.nodes[0]] } });
    expect(() => editedTemplateDraft()).toThrow("一个主节点");
  });
});
