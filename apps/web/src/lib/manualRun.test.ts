import { describe, expect, it } from "vitest";
import { manualRunUnavailableReason } from "./manualRun";
import type { NodeType, WorkflowDocument, WorkflowNode } from "../types";

const assertionType: NodeType = {
  id: "assert.status_code",
  name: "状态码断言",
  category: "assertion",
  description: "",
  inputs: { input: { required: true, displayName: "响应" } },
  outputs: { passed: {}, failed: {} },
  configSchema: { type: "object", properties: {} },
};

const sourceNode: WorkflowNode = {
  id: "source",
  type: "manual.trigger",
  position: { x: 0, y: 0 },
  config: {},
};

const targetNode: WorkflowNode = {
  id: "target",
  type: "assert.status_code",
  position: { x: 240, y: 0 },
  config: {},
};

function workflowWithSource(source: WorkflowNode): WorkflowDocument {
  return {
    id: "workflow_1",
    name: "局部运行",
    version: 1,
    nodes: [source, targetNode],
    edges: [
      {
        id: "source_target",
        source: source.id,
        sourceHandle: "success",
        target: targetNode.id,
        targetHandle: "input",
      },
    ],
  };
}

describe("manualRunUnavailableReason", () => {
  it("explains missing required input when the upstream output is not pinned", () => {
    expect(manualRunUnavailableReason(targetNode, assertionType, workflowWithSource(sourceNode))).toBe(
      "此节点需要“响应”输入；请使用完整运行。"
    );
  });

  it("allows a required input supplied by a direct upstream pinned output", () => {
    const pinnedSource = { ...sourceNode, pinnedData: { success: { status_code: 200 } } };

    expect(manualRunUnavailableReason(targetNode, assertionType, workflowWithSource(pinnedSource))).toBeUndefined();
  });

  it("does not treat an unrelated pinned output as input data", () => {
    const pinnedSource = { ...sourceNode, pinnedData: { other: { status_code: 200 } } };

    expect(manualRunUnavailableReason(targetNode, assertionType, workflowWithSource(pinnedSource))).toBe(
      "此节点需要“响应”输入；请使用完整运行。"
    );
  });
});
