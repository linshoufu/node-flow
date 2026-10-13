import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowDocument } from "@/types";
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
