import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
  it("does not feed controlled selection back into React Flow nodes", () => {
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
    expect(nodes[0]).not.toHaveProperty("selected");
    expect(reactFlowProps.current?.onSelectionChange).toBeUndefined();
  });
});
