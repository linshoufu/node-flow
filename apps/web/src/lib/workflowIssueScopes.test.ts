import { describe, expect, it } from "vitest";
import type { WorkflowEdge, WorkflowNode } from "../types";
import type { NodeRuntimeNavigationTarget } from "./nodeRuntimeNavigation";
import {
  areEditScopesEqual,
  buildEdgeIssuesByEdgeId,
  buildNodeIssuesByNodeId,
  editScopeFromIssuePath,
  editScopeFromRunEventScope,
  isIssuePathInCurrentEditScope,
  isRunSelectionInCurrentEditScope,
} from "./workflowIssueScopes";
import type { WorkflowIssueItem } from "./workflowIssues";

function createIssue(overrides: Partial<WorkflowIssueItem> & Pick<WorkflowIssueItem, "id" | "target">): WorkflowIssueItem {
  return {
    source: "validation",
    severity: "error",
    title: "问题",
    message: "问题详情",
    location: "节点 node_1",
    ...overrides,
  };
}

function createNode(id: string): WorkflowNode {
  return { id, type: "test.node", position: { x: 0, y: 0 }, config: {} };
}

function createEdge(id: string): WorkflowEdge {
  return { id, source: "a", sourceHandle: "success", target: "b", targetHandle: "input" };
}

function createRunTarget(scope: string[]): NodeRuntimeNavigationTarget {
  return { nodeId: "node_1", scope, source: "canvas" };
}

describe("editScopeFromIssuePath", () => {
  it("returns empty scope for undefined or non-root paths", () => {
    expect(editScopeFromIssuePath(undefined)).toEqual([]);
    expect(editScopeFromIssuePath(["nodes", "node_1"])).toEqual([]);
  });

  it("returns empty scope for a root-level path", () => {
    expect(editScopeFromIssuePath(["root"])).toEqual([]);
    // 根级节点 issue 路径为 ["root", nodeId]，最后一段是定位段，不参与作用域。
    expect(editScopeFromIssuePath(["root", "node_1"])).toEqual([]);
  });

  it("extracts nested subflow steps from paired path segments", () => {
    // 子流程内节点 issue 路径为 ["root", loopId, subflowName, ..., nodeId]。
    expect(editScopeFromIssuePath(["root", "loop_1", "body", "node_2"])).toEqual([
      { nodeId: "loop_1", subflowName: "body" },
    ]);
    expect(editScopeFromIssuePath(["root", "loop_1", "body", "loop_2", "body", "node_3"])).toEqual([
      { nodeId: "loop_1", subflowName: "body" },
      { nodeId: "loop_2", subflowName: "body" },
    ]);
  });

  it("stops at an incomplete trailing pair", () => {
    expect(editScopeFromIssuePath(["root", "loop_1"])).toEqual([]);
  });
});

describe("editScopeFromRunEventScope", () => {
  it("maps node ids to body subflows and skips iteration markers", () => {
    expect(editScopeFromRunEventScope(undefined)).toEqual([]);
    expect(editScopeFromRunEventScope(["loop_1", "iteration:3"])).toEqual([
      { nodeId: "loop_1", subflowName: "body" },
    ]);
  });
});

describe("areEditScopesEqual", () => {
  it("compares steps by nodeId and subflowName", () => {
    expect(areEditScopesEqual([], [])).toBe(true);
    expect(
      areEditScopesEqual([{ nodeId: "loop_1", subflowName: "body" }], [{ nodeId: "loop_1", subflowName: "body" }])
    ).toBe(true);
    expect(
      areEditScopesEqual([{ nodeId: "loop_1", subflowName: "body" }], [{ nodeId: "loop_1", subflowName: "error" }])
    ).toBe(false);
    expect(areEditScopesEqual([{ nodeId: "loop_1", subflowName: "body" }], [])).toBe(false);
  });
});

describe("isIssuePathInCurrentEditScope", () => {
  it("matches root-level issues against an undefined edit scope", () => {
    expect(isIssuePathInCurrentEditScope(undefined, undefined)).toBe(true);
    expect(isIssuePathInCurrentEditScope(["root", "node_1"], [])).toBe(true);
  });

  it("rejects subflow issues when the subflow is not open", () => {
    expect(isIssuePathInCurrentEditScope(["root", "loop_1", "body", "node_2"], undefined)).toBe(false);
  });

  it("accepts subflow issues when the same subflow is open", () => {
    expect(
      isIssuePathInCurrentEditScope(["root", "loop_1", "body", "node_2"], [
        { nodeId: "loop_1", subflowName: "body" },
      ])
    ).toBe(true);
  });
});

describe("isRunSelectionInCurrentEditScope", () => {
  it("matches run event scopes to the open edit scope", () => {
    expect(isRunSelectionInCurrentEditScope(createRunTarget([]), undefined)).toBe(true);
    expect(
      isRunSelectionInCurrentEditScope(createRunTarget(["loop_1", "iteration:0"]), [
        { nodeId: "loop_1", subflowName: "body" },
      ])
    ).toBe(true);
    expect(isRunSelectionInCurrentEditScope(createRunTarget(["loop_1"]), undefined)).toBe(false);
  });
});

describe("buildNodeIssuesByNodeId", () => {
  const rootNodeIssue = createIssue({ id: "v1", target: { kind: "node", nodeId: "node_1" } });
  const subflowNodeIssue = createIssue({
    id: "p1",
    source: "pre_run",
    target: { kind: "node", nodeId: "node_2", path: ["root", "loop_1", "body", "node_2"] },
  });
  const settingsIssue = createIssue({ id: "s1", target: { kind: "settings", field: "timeout_seconds" } });

  it("groups only editable node issues and ignores non-node targets", () => {
    const result = buildNodeIssuesByNodeId([rootNodeIssue, settingsIssue], [createNode("node_1")], undefined);
    expect(result).toEqual({ node_1: [rootNodeIssue] });
  });

  it("skips issues for nodes outside the editable set", () => {
    const result = buildNodeIssuesByNodeId([rootNodeIssue], [], undefined);
    expect(result).toEqual({});
  });

  it("keeps validation issues regardless of path scope but filters out-of-scope pre_run issues", () => {
    const result = buildNodeIssuesByNodeId(
      [rootNodeIssue, subflowNodeIssue],
      [createNode("node_1"), createNode("node_2")],
      undefined
    );
    expect(result).toEqual({ node_1: [rootNodeIssue] });
  });

  it("includes pre_run issues once the matching subflow is open", () => {
    const result = buildNodeIssuesByNodeId(
      [rootNodeIssue, subflowNodeIssue],
      [createNode("node_1"), createNode("node_2")],
      [{ nodeId: "loop_1", subflowName: "body" }]
    );
    expect(result).toEqual({ node_1: [rootNodeIssue], node_2: [subflowNodeIssue] });
  });
});

describe("buildEdgeIssuesByEdgeId", () => {
  const rootEdgeIssue = createIssue({ id: "e1", target: { kind: "edge", edgeId: "edge_1" } });
  const subflowEdgeIssue = createIssue({
    id: "e2",
    source: "pre_run",
    target: { kind: "edge", edgeId: "edge_2", path: ["root", "loop_1", "body"] },
  });
  const nodeIssue = createIssue({ id: "n1", target: { kind: "node", nodeId: "node_1" } });

  it("groups only editable edge issues and ignores non-edge targets", () => {
    const result = buildEdgeIssuesByEdgeId([rootEdgeIssue, nodeIssue], [createEdge("edge_1")], undefined);
    expect(result).toEqual({ edge_1: [rootEdgeIssue] });
  });

  it("filters out-of-scope pre_run edge issues until the subflow is open", () => {
    const edges = [createEdge("edge_1"), createEdge("edge_2")];
    expect(buildEdgeIssuesByEdgeId([rootEdgeIssue, subflowEdgeIssue], edges, undefined)).toEqual({
      edge_1: [rootEdgeIssue],
    });
    expect(
      buildEdgeIssuesByEdgeId([rootEdgeIssue, subflowEdgeIssue], edges, [{ nodeId: "loop_1", subflowName: "body" }])
    ).toEqual({ edge_1: [rootEdgeIssue], edge_2: [subflowEdgeIssue] });
  });
});
