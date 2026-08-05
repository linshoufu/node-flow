import { describe, expect, it } from "vitest";
import { resolveWorkflowIssueSelection, type WorkflowIssueSelectionOptions } from "./workflowIssueSelection";
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

function createOptions(overrides: Partial<WorkflowIssueSelectionOptions> = {}): WorkflowIssueSelectionOptions {
  return {
    editScope: undefined,
    editableNodeIds: new Set(["node_1"]),
    editableEdgeIds: new Set(["edge_1"]),
    ...overrides,
  };
}

describe("resolveWorkflowIssueSelection", () => {
  it("selects an editable node in the current scope", () => {
    const issue = createIssue({
      id: "n1",
      target: { kind: "node", nodeId: "node_1", field: "url" },
    });
    expect(resolveWorkflowIssueSelection(issue, createOptions())).toEqual({
      kind: "node",
      nodeId: "node_1",
      field: "url",
    });
  });

  it("selects a validation node regardless of issue path scope when the node is editable", () => {
    const issue = createIssue({
      id: "n2",
      target: { kind: "node", nodeId: "node_1", path: ["root", "loop_1", "body", "node_1"] },
    });
    expect(resolveWorkflowIssueSelection(issue, createOptions())).toEqual({
      kind: "node",
      nodeId: "node_1",
      field: undefined,
    });
  });

  it("blocks a pre_run node issue outside the open edit scope", () => {
    const issue = createIssue({
      id: "n3",
      source: "pre_run",
      target: { kind: "node", nodeId: "node_1", path: ["root", "loop_1", "body", "node_1"] },
    });
    const selection = resolveWorkflowIssueSelection(issue, createOptions());
    expect(selection).toEqual({
      kind: "message",
      message: "这个运行前问题属于未打开的子流程，请先进入对应循环体查看。",
      resetEdgeFocus: false,
    });
  });

  it("allows a pre_run node issue once the matching subflow is open", () => {
    const issue = createIssue({
      id: "n4",
      source: "pre_run",
      target: { kind: "node", nodeId: "node_1", path: ["root", "loop_1", "body", "node_1"] },
    });
    const selection = resolveWorkflowIssueSelection(
      issue,
      createOptions({ editScope: [{ nodeId: "loop_1", subflowName: "body" }] })
    );
    expect(selection).toEqual({ kind: "node", nodeId: "node_1", field: undefined });
  });

  it("blocks node issues whose node left the editable document", () => {
    const validationIssue = createIssue({ id: "n5", target: { kind: "node", nodeId: "missing" } });
    expect(resolveWorkflowIssueSelection(validationIssue, createOptions())).toEqual({
      kind: "message",
      message: "这个验证问题属于未打开的子流程，请先进入对应循环体查看。",
      resetEdgeFocus: false,
    });
  });

  it("opens workflow settings for settings issues", () => {
    const issue = createIssue({ id: "s1", target: { kind: "settings", field: "timeout_seconds" } });
    expect(resolveWorkflowIssueSelection(issue, createOptions())).toEqual({
      kind: "settings",
      field: "timeout_seconds",
    });
  });

  it("focuses an editable edge in the current scope", () => {
    const issue = createIssue({ id: "e1", target: { kind: "edge", edgeId: "edge_1" } });
    expect(resolveWorkflowIssueSelection(issue, createOptions())).toEqual({ kind: "edge", edgeId: "edge_1" });
  });

  it("blocks a pre_run edge issue outside the open edit scope", () => {
    const issue = createIssue({
      id: "e2",
      source: "pre_run",
      target: { kind: "edge", edgeId: "edge_1", path: ["root", "loop_1", "body"] },
    });
    expect(resolveWorkflowIssueSelection(issue, createOptions())).toEqual({
      kind: "message",
      message: "这个运行前连线问题属于未打开的子流程，请先进入对应循环体查看。",
      resetEdgeFocus: false,
    });
  });

  it("blocks edge issues whose edge left the editable document", () => {
    const issue = createIssue({ id: "e3", target: { kind: "edge", edgeId: "missing" } });
    expect(resolveWorkflowIssueSelection(issue, createOptions())).toEqual({
      kind: "message",
      message: "这个验证连线问题属于未打开的子流程，请先进入对应循环体查看。",
      resetEdgeFocus: false,
    });
  });

  it("falls back to a generic check message for workflow-level issues", () => {
    const issue = createIssue({ id: "w1", target: { kind: "workflow" } });
    expect(resolveWorkflowIssueSelection(issue, createOptions())).toEqual({
      kind: "message",
      message: "请根据提示检查对应连线或工作流配置。",
      resetEdgeFocus: true,
    });
  });
});
