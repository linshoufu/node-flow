import { describe, expect, it } from "vitest";
import type { NodeType, WorkflowDocument } from "../types";
import { buildEdgeRepairCandidates } from "./edgeRepairCandidates";

const sourceType: NodeType = {
  id: "source",
  name: "Source",
  category: "Test",
  description: "Source node",
  inputs: {},
  outputs: {
    output: { displayName: "输出", schema: { type: "number" } },
  },
  configSchema: { type: "object" },
};

const sinkType: NodeType = {
  id: "sink",
  name: "Sink",
  category: "Test",
  description: "Sink node",
  inputs: {
    old_input: { displayName: "旧输入", schema: { type: "number" } },
    input: { displayName: "输入", schema: { type: "number" } },
    text: { displayName: "文本", schema: { type: "string" } },
  },
  outputs: {},
  configSchema: { type: "object" },
};

const workflow: WorkflowDocument = {
  id: "wf",
  name: "Workflow",
  version: 1,
  nodes: [
    { id: "source_1", type: "source", position: { x: 0, y: 0 }, config: {} },
    { id: "sink_1", type: "sink", position: { x: 200, y: 0 }, config: {} },
  ],
  edges: [
    {
      id: "edge_1",
      source: "source_1",
      sourceHandle: "output",
      target: "sink_1",
      targetHandle: "old_input",
    },
  ],
};

describe("buildEdgeRepairCandidates", () => {
  it("offers compatible target input ports except the current broken handle", () => {
    expect(buildEdgeRepairCandidates(workflow.edges[0], workflow, [sourceType, sinkType])).toEqual([
      { handle: "input", label: "输入" },
    ]);
  });

  it("does not offer an already occupied single-connection input", () => {
    const occupiedWorkflow: WorkflowDocument = {
      ...workflow,
      edges: [
        ...workflow.edges,
        {
          id: "edge_2",
          source: "source_1",
          sourceHandle: "output",
          target: "sink_1",
          targetHandle: "input",
        },
      ],
    };

    expect(buildEdgeRepairCandidates(occupiedWorkflow.edges[0], occupiedWorkflow, [sourceType, sinkType])).toEqual([]);
  });

  it("offers configured dynamic input ports for a broken edge", () => {
    const dynamicSinkType: NodeType = {
      ...sinkType,
      id: "dynamic.sink",
      inputs: {},
      dynamicInputs: {
        configKey: "targets",
        idKey: "id",
        labelKey: "label",
        input: { schema: { type: "number" } },
      },
    };
    const dynamicWorkflow: WorkflowDocument = {
      ...workflow,
      nodes: [
        workflow.nodes[0],
        {
          ...workflow.nodes[1],
          type: "dynamic.sink",
          config: { targets: [{ id: "replacement", label: "替换输入" }] },
        },
      ],
    };

    expect(buildEdgeRepairCandidates(dynamicWorkflow.edges[0], dynamicWorkflow, [sourceType, dynamicSinkType])).toEqual([
      { handle: "replacement", label: "替换输入" },
    ]);
  });
});
