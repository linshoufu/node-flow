import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDocument } from "@/types";
import { apiClient } from "@/api/client";
import { getActiveGraph, useWorkflowStore } from "./workflow";

const workflow: WorkflowDocument = {
  id: "workflow-1",
  name: "Scoped canvas",
  version: 1,
  nodes: [
    {
      id: "each",
      type: "control.each_item",
      label: "逐项处理",
      position: { x: 0, y: 0 },
      config: {},
      subflows: {
        body: {
          nodes: [
            { id: "request", type: "network.http", position: { x: 40, y: 60 }, config: { method: "GET" } },
          ],
          edges: [],
        },
      },
    },
  ],
  edges: [],
};

describe("workflow scoped canvas", () => {
  it("replaces scoped configuration atomically while keeping bindings and parent configuration", () => {
    useWorkflowStore.setState({ workflow: structuredClone(workflow), canvasScope: [{ nodeId: "each", key: "body", label: "Body" }], isDirty: false });
    useWorkflowStore.getState().setNodeBindings("request", { method: { source: "workflow", key: "method" } });
    useWorkflowStore.getState().replaceNodeConfig("request", { common_fields: [{ name: "key", on_difference: "split" }] });
    const result = useWorkflowStore.getState().workflow;
    expect(result.nodes[0].config).toEqual({});
    expect(result.nodes[0].subflows?.body.nodes[0].config).toEqual({ common_fields: [{ name: "key", on_difference: "split" }] });
    expect(result.nodes[0].subflows?.body.nodes[0].configBindings?.method.key).toBe("method");
    expect(useWorkflowStore.getState().isDirty).toBe(true);
  });
  it("inserts user presets with independent config dependencies and refuses conflicting defaults", () => {
    useWorkflowStore.setState({ workflow: structuredClone(workflow), canvasScope: [], isDirty: false });
    const asset = { id: "mine", name: "Mine", kind: "node" as const, source: "user" as const, packageId: "user", packageVersion: "1", configuration: [{ name: "warehouse", type: "json" as const, default: { id: "one" } }], node: { id: "source", type: "data.compose", position: { x: 0, y: 0 }, config: {}, configBindings: { "options.warehouse": { source: "workflow" as const, key: "warehouse" } } } };
    useWorkflowStore.getState().insertTemplate(asset);
    const result = useWorkflowStore.getState().workflow;
    expect(result.nodes[1].id).not.toBe("source");
    expect(result.settings?.configuration?.[0].default).toEqual({ id: "one" });
    expect(result.settings?.configuration).not.toBe(asset.configuration);
    useWorkflowStore.setState({ isDirty: false });
    useWorkflowStore.getState().insertTemplate({ ...asset, configuration: [{ name: "warehouse", type: "json", default: { id: "other" } }] });
    expect(useWorkflowStore.getState().workflow).toBe(result);
    expect(useWorkflowStore.getState().isDirty).toBe(false);
  });
  it("keeps workflow configuration separate from scoped node bindings and plain config", () => {
    useWorkflowStore.setState({ workflow: structuredClone(workflow), canvasScope: [{ nodeId: "each", key: "body", label: "Body" }], isDirty: false });
    useWorkflowStore.getState().setWorkflowConfiguration([{ name: "method", type: "string", default: "POST" }]);
    useWorkflowStore.getState().setNodeBindings("request", { method: { source: "workflow", key: "method" } });
    const result = useWorkflowStore.getState().workflow;
    expect(result.settings?.configuration?.[0].default).toBe("POST");
    expect(result.nodes[0].subflows?.body.nodes[0].config).toEqual({ method: "GET" });
    expect(result.nodes[0].subflows?.body.nodes[0].configBindings).toEqual({ method: { source: "workflow", key: "method" } });
    expect(result.nodes[0].configBindings).toBeUndefined();
    expect(useWorkflowStore.getState().isDirty).toBe(true);
  });
  it("clones preset nodes without sharing configuration or IDs", () => {
    useWorkflowStore.setState({ workflow: structuredClone(workflow), canvasScope: [], isDirty: false });
    const node = { id: "preset", type: "data.compose", position: { x: 0, y: 0 }, config: { rules: [{ name: "x", expression: "1" }] } };
    const template = { id: "demo", name: "Demo", kind: "node" as const, packageId: "demo", packageVersion: "1", node };
    useWorkflowStore.getState().insertTemplate(template);
    useWorkflowStore.getState().insertTemplate(template);
    const nodes = useWorkflowStore.getState().workflow.nodes;
    expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length);
    expect(nodes[1].config).not.toBe(node.config);
    expect(node.id).toBe("preset");
  });

  it("does not replace a populated subflow with a template", () => {
    useWorkflowStore.setState({ workflow: structuredClone(workflow), canvasScope: [{ nodeId: "each", key: "body", label: "Body" }], isDirty: false });
    const before = useWorkflowStore.getState().workflow;
    useWorkflowStore.getState().insertTemplate({ id: "body", name: "Body", kind: "subflow", packageId: "demo", packageVersion: "1", graph: { nodes: [], edges: [] } });
    expect(useWorkflowStore.getState().workflow).toBe(before);
    expect(useWorkflowStore.getState().isDirty).toBe(false);
  });
  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: structuredClone(workflow),
      selectedNodeId: null,
      canvasScope: [],
      isDirty: false,
      isSaving: false,
      saveError: null,
    });
  });

  it("enters and exits a node subflow", () => {
    useWorkflowStore.getState().enterSubflow("each", "body", "逐项处理");

    const entered = useWorkflowStore.getState();
    expect(entered.canvasScope).toEqual([{ nodeId: "each", key: "body", label: "逐项处理" }]);
    expect(getActiveGraph(entered.workflow, entered.canvasScope).nodes.map((node) => node.id)).toEqual(["request"]);

    entered.exitSubflow();
    expect(useWorkflowStore.getState().canvasScope).toEqual([]);
  });

  it("updates and deletes nodes only inside the active subflow", () => {
    const store = useWorkflowStore.getState();
    store.enterSubflow("each", "body", "逐项处理");
    useWorkflowStore.getState().updateNodeConfig("request", "method", "POST");

    let state = useWorkflowStore.getState();
    expect(getActiveGraph(state.workflow, state.canvasScope).nodes[0]?.config.method).toBe("POST");
    expect(state.workflow.nodes[0]?.id).toBe("each");

    useWorkflowStore.getState().deleteNode("request");
    state = useWorkflowStore.getState();
    expect(getActiveGraph(state.workflow, state.canvasScope).nodes).toEqual([]);
    expect(state.workflow.nodes).toHaveLength(1);
  });
});

describe("workflow save failures", () => {
  const conflict = 'API 409: {"detail":{"code":"workflow_version_conflict","message":"工作流已被其他操作更新，请重新加载后再继续。","expected_version":1,"current_version":2}}';

  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: structuredClone(workflow),
      selectedNodeId: null,
      canvasScope: [],
      isDirty: true,
      isSaving: false,
      saveError: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports a version conflict instead of failing silently", async () => {
    vi.spyOn(apiClient, "saveWorkflow").mockRejectedValue(new Error(conflict));

    await useWorkflowStore.getState().saveWorkflow();
    const state = useWorkflowStore.getState();
    expect(state.isSaving).toBe(false);
    expect(state.isDirty).toBe(true);
    expect(state.saveError?.kind).toBe("conflict");
    expect(state.saveError?.currentVersion).toBe(2);
    expect(state.saveError?.message).toContain("重新加载");
  });

  it("clears the failure after a successful save", async () => {
    useWorkflowStore.setState({ saveError: { kind: "conflict", message: "上一次失败" } });
    vi.spyOn(apiClient, "saveWorkflow").mockResolvedValue({ ...structuredClone(workflow), version: 2 });

    await useWorkflowStore.getState().saveWorkflow();
    const state = useWorkflowStore.getState();
    expect(state.saveError).toBeNull();
    expect(state.isDirty).toBe(false);
    expect(state.workflow.version).toBe(2);
  });

  it("saves the local canvas as a new copy when the conflict cannot be retried", async () => {
    const copy: WorkflowDocument = { ...structuredClone(workflow), id: "workflow-2", name: "Scoped canvas（副本）", version: 1 };
    const save = vi.spyOn(apiClient, "saveWorkflow").mockResolvedValue(copy);
    vi.spyOn(apiClient, "listWorkflows").mockResolvedValue([]);
    vi.spyOn(apiClient, "getWorkflow").mockResolvedValue(copy);
    useWorkflowStore.setState({ saveError: { kind: "conflict", message: "版本冲突" } });

    await useWorkflowStore.getState().saveAsCopy();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "", name: "Scoped canvas（副本）" }));
    const state = useWorkflowStore.getState();
    expect(state.workflow.id).toBe("workflow-2");
    expect(state.saveError).toBeNull();
    expect(state.isDirty).toBe(false);
  });

  it("reloads the server version and drops the local conflict", async () => {
    const server: WorkflowDocument = { ...structuredClone(workflow), version: 4, name: "服务器版本" };
    vi.spyOn(apiClient, "getWorkflow").mockResolvedValue(server);
    useWorkflowStore.setState({ saveError: { kind: "conflict", message: "版本冲突" }, canvasScope: [{ nodeId: "each", key: "body", label: "逐项处理" }] });

    await useWorkflowStore.getState().reloadFromServer();
    const state = useWorkflowStore.getState();
    expect(state.workflow.name).toBe("服务器版本");
    expect(state.workflow.version).toBe(4);
    expect(state.canvasScope).toEqual([]);
    expect(state.saveError).toBeNull();
  });
});
