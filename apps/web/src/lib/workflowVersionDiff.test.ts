import { describe, expect, it } from "vitest";
import type { WorkflowDocument } from "../types";
import { buildWorkflowVersionDiff } from "./workflowVersionDiff";

describe("buildWorkflowVersionDiff", () => {
  it("separates node content and layout changes while summarizing workflow changes", () => {
    const baseline = workflow({
      version: 1,
      description: "旧版请求流程",
      tags: ["发布", "接口"],
      nodes: [node("request", { config: { url: "https://old.example" }, position: { x: 10, y: 20 } })],
      settings: { timeout_seconds: 60 },
    });
    const current = workflow({
      version: 2,
      active: true,
      description: "新版请求流程",
      tags: ["接口", "回归"],
      nodes: [
        node("request", { config: { url: "https://new.example" }, position: { x: 80, y: 20 } }),
        node("assert"),
      ],
      edges: [{ id: "request-success-assert-input", source: "request", sourceHandle: "success", target: "assert", targetHandle: "input" }],
      settings: { timeout_seconds: 120 },
    });

    expect(buildWorkflowVersionDiff(baseline, current)).toMatchObject({
      baselineVersion: 1,
      currentVersion: 2,
      changed: true,
      addedNodeIds: ["assert"],
      removedNodeIds: [],
      changedNodeIds: ["request"],
      movedNodeIds: ["request"],
      addedEdgeCount: 1,
      removedEdgeCount: 0,
      metadataChanged: true,
      settingsChanged: true,
      annotationsChanged: false,
    });
  });

  it("reports no changes for identical workflow versions", () => {
    const document = workflow({ version: 4, nodes: [node("trigger")] });

    expect(buildWorkflowVersionDiff(document, document)).toMatchObject({
      changed: false,
      addedNodeIds: [],
      removedNodeIds: [],
      changedNodeIds: [],
      movedNodeIds: [],
      addedEdgeCount: 0,
      removedEdgeCount: 0,
      metadataChanged: false,
      settingsChanged: false,
      annotationsChanged: false,
    });
  });
});

function workflow(overrides: Partial<WorkflowDocument>): WorkflowDocument {
  return {
    id: "workflow_1",
    name: "版本审阅",
    version: 1,
    nodes: [],
    edges: [],
    settings: { timeout_seconds: 600 },
    ...overrides,
  };
}

function node(
  id: string,
  overrides: Partial<WorkflowDocument["nodes"][number]> = {}
): WorkflowDocument["nodes"][number] {
  return {
    id,
    type: "demo.node",
    position: { x: 0, y: 0 },
    config: {},
    ...overrides,
  };
}
