import { act, cleanup, render } from "@testing-library/react";
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

const logType: NodeType = {
  id: "utility.log",
  name: "Log",
  category: "utility",
  description: "Write an input value to the run log.",
  inputs: {
    input: {},
  },
  outputs: {},
  configSchema: {
    type: "object",
    properties: {},
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

const emptyWorkflow: WorkflowDocument = {
  ...workflow,
  nodes: [],
  edges: [],
};

const workflowWithEdge: WorkflowDocument = {
  ...workflow,
  nodes: [
    ...workflow.nodes,
    {
      id: "node_log",
      type: "utility.log",
      position: { x: 320, y: 80 },
      config: {},
    },
  ],
  edges: [
    {
      id: "edge_manual_log",
      source: "node_manual",
      sourceHandle: "output",
      target: "node_log",
      targetHandle: "input",
    },
  ],
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

  it("passes runtime state into controlled React Flow nodes", () => {
    render(
      <FlowCanvas
        nodeRunStates={{
          node_manual: {
            nodeId: "node_manual",
            status: "succeeded",
            outputs: { success: {} },
            durationMs: 3,
            scopes: [[]],
          },
        }}
        nodeTypes={[manualTriggerType]}
        selectedNodeId="node_manual"
        workflow={workflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const nodes = reactFlowProps.current?.nodes as Array<{ data: Record<string, unknown> }>;
    expect(nodes[0].data.runtimeState).toMatchObject({
      nodeId: "node_manual",
      status: "succeeded",
      durationMs: 3,
    });
  });

  it("does not fit an empty canvas before nodes are added", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType]}
        selectedNodeId={null}
        workflow={emptyWorkflow}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect(reactFlowProps.current?.fitView).toBeUndefined();
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
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId="node_manual"
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={onWorkflowChange}
      />
    );

    const onNodesChange = reactFlowProps.current?.onNodesChange as (changes: Array<Record<string, unknown>>) => void;
    onNodesChange([{ id: "node_manual", type: "remove" }]);

    expect(onWorkflowChange).toHaveBeenCalledWith({
      ...workflowWithEdge,
      nodes: [workflowWithEdge.nodes[1]],
      edges: [],
    });
  });

  it("passes selected edge changes into controlled React Flow edges", () => {
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const initialEdges = reactFlowProps.current?.edges as Array<Record<string, unknown>>;
    expect(initialEdges[0]).toHaveProperty("selected", false);

    const onEdgesChange = reactFlowProps.current?.onEdgesChange as (changes: Array<Record<string, unknown>>) => void;
    act(() => {
      onEdgesChange([{ id: "edge_manual_log", type: "select", selected: true }]);
    });

    const selectedEdges = reactFlowProps.current?.edges as Array<Record<string, unknown>>;
    expect(selectedEdges[0]).toHaveProperty("selected", true);

    act(() => {
      onEdgesChange([{ id: "edge_manual_log", type: "select", selected: false }]);
    });

    const deselectedEdges = reactFlowProps.current?.edges as Array<Record<string, unknown>>;
    expect(deselectedEdges[0]).toHaveProperty("selected", false);
  });

  it("clears selected edges when the selection reset key changes", () => {
    const { rerender } = render(
      <FlowCanvas
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        selectionResetKey="root"
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    const onEdgesChange = reactFlowProps.current?.onEdgesChange as (changes: Array<Record<string, unknown>>) => void;
    act(() => {
      onEdgesChange([{ id: "edge_manual_log", type: "select", selected: true }]);
    });
    expect((reactFlowProps.current?.edges as Array<Record<string, unknown>>)[0]).toHaveProperty("selected", true);

    rerender(
      <FlowCanvas
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        selectionResetKey="foreach.body"
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={vi.fn()}
      />
    );

    expect((reactFlowProps.current?.edges as Array<Record<string, unknown>>)[0]).toHaveProperty("selected", false);
  });

  it("removes edges from controlled React Flow edge changes", () => {
    const onWorkflowChange = vi.fn();
    render(
      <FlowCanvas
        nodeTypes={[manualTriggerType, logType]}
        selectedNodeId={null}
        workflow={workflowWithEdge}
        onSelectNode={vi.fn()}
        onWorkflowChange={onWorkflowChange}
      />
    );

    const onEdgesChange = reactFlowProps.current?.onEdgesChange as (changes: Array<Record<string, unknown>>) => void;
    onEdgesChange([{ id: "edge_manual_log", type: "remove" }]);

    expect(onWorkflowChange).toHaveBeenCalledWith({
      ...workflowWithEdge,
      edges: [],
    });
  });
});
