import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeType, WorkflowDocument } from "../types";
import { FlowCanvas } from "./FlowCanvas";

const reactFlowProps = vi.hoisted(() => ({
  current: undefined as undefined | Record<string, unknown>,
}));

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Left: "left", Right: "right" },
  ReactFlow: (props: Record<string, unknown>) => {
    reactFlowProps.current = props;
    return <div aria-label="Mock React Flow" />;
  },
}));

const manualTriggerType: NodeType = {
  id: "manual.trigger",
  name: "Manual Trigger",
  category: "trigger",
  description: "Start a workflow manually.",
  inputs: {},
  outputs: {
    output: {},
  },
  configSchema: {
    type: "object",
    properties: {
      payload: { type: "object", additionalProperties: true },
    },
  },
};

const workflow: WorkflowDocument = {
  id: "wf_test",
  name: "Test Workflow",
  version: 1,
  nodes: [
    {
      id: "node_manual",
      type: "manual.trigger",
      position: { x: 80, y: 80 },
      config: { payload: {} },
    },
  ],
  edges: [],
};

describe("FlowCanvas", () => {
  afterEach(() => {
    cleanup();
    reactFlowProps.current = undefined;
  });

  it("passes selected state into controlled React Flow nodes", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId="node_manual"
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(reactFlowProps.current).toBeDefined();
    const nodes = reactFlowProps.current?.nodes as Array<Record<string, unknown>>;
    expect(nodes[0]).toHaveProperty("selected", true);
    expect(reactFlowProps.current?.deleteKeyCode).toEqual(["Delete", "Backspace"]);
    expect(reactFlowProps.current?.onSelectionChange).toBeUndefined();
  });

  it("round-trips select node changes into app selection", () => {
    const onSelectNode = vi.fn();
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={workflow}
        onSelectNode={onSelectNode}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(reactFlowProps.current).toBeDefined();
    expect(reactFlowProps.current?.onSelectionChange).toBeUndefined();

    const onNodesChange = reactFlowProps.current?.onNodesChange as (changes: Array<Record<string, unknown>>) => void;
    onNodesChange([{ id: "node_manual", type: "select", selected: true }]);
    expect(onSelectNode).toHaveBeenLastCalledWith("node_manual");
  });

  it("round-trips deselect node changes into app selection", () => {
    const onSelectNode = vi.fn();
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId="node_manual"
        workflow={workflow}
        onSelectNode={onSelectNode}
        onWorkflowChange={vi.fn()}
      />
    );

    const onNodesChange = reactFlowProps.current?.onNodesChange as (changes: Array<Record<string, unknown>>) => void;
    onNodesChange([{ id: "node_manual", type: "select", selected: false }]);
    expect(onSelectNode).toHaveBeenLastCalledWith(null);
  });

  it("keeps remove changes wired while selection is controlled", () => {
    const onWorkflowChange = vi.fn();
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId="node_manual"
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={onWorkflowChange}
      />
    );

    const onNodesChange = reactFlowProps.current?.onNodesChange as (changes: Array<Record<string, unknown>>) => void;
    onNodesChange([{ id: "node_manual", type: "remove" }]);

    expect(onWorkflowChange).toHaveBeenCalledWith({
      ...workflow,
      nodes: [],
      edges: [],
    });
  });
});
