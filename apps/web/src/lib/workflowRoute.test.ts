import { describe, expect, it } from "vitest";
import { parseWorkflowRoute, workflowRoutePath, workflowRoutesEqual } from "./workflowRoute";

describe("workflowRoute", () => {
  it("treats the root and unknown paths as a new workflow", () => {
    expect(parseWorkflowRoute("/")).toEqual({ kind: "new" });
    expect(parseWorkflowRoute("/settings")).toEqual({ kind: "new" });
    expect(parseWorkflowRoute("/workflow/new")).toEqual({ kind: "new" });
  });

  it("parses workflow and selected node deep links", () => {
    expect(parseWorkflowRoute("/workflow/wf-1")).toEqual({
      kind: "workflow",
      workflowId: "wf-1",
    });
    expect(parseWorkflowRoute("/workflow/wf%2F1/node%20one")).toEqual({
      kind: "workflow",
      workflowId: "wf/1",
      nodeId: "node one",
    });
  });

  it("parses execution previews and their selected node", () => {
    expect(parseWorkflowRoute("/workflow/wf-1/executions/run-9")).toEqual({
      kind: "execution",
      workflowId: "wf-1",
      executionId: "run-9",
    });
    expect(parseWorkflowRoute("/workflow/wf-1/executions/run%2F9/node%201")).toEqual({
      kind: "execution",
      workflowId: "wf-1",
      executionId: "run/9",
      nodeId: "node 1",
    });
    expect(parseWorkflowRoute("/workflow/wf-1/executions")).toEqual({
      kind: "workflow",
      workflowId: "wf-1",
    });
  });

  it("rejects malformed and overlong workflow paths", () => {
    expect(parseWorkflowRoute("/workflow/%E0%A4%A")).toEqual({ kind: "new" });
    expect(parseWorkflowRoute("/workflow/wf-1/node-1/extra")).toEqual({ kind: "new" });
  });

  it("parses known resource sections and rejects unknown ones", () => {
    expect(parseWorkflowRoute("/resources/assets")).toEqual({
      kind: "resources",
      section: "assets",
    });
    expect(parseWorkflowRoute("/resources/packages")).toEqual({
      kind: "resources",
      section: "packages",
    });
    expect(parseWorkflowRoute("/resources/credentials")).toEqual({
      kind: "resources",
      section: "credentials",
    });
    expect(parseWorkflowRoute("/resources/variables")).toEqual({
      kind: "resources",
      section: "variables",
    });
    expect(parseWorkflowRoute("/resources/environments")).toEqual({
      kind: "resources",
      section: "environments",
    });
  });

  it("falls back to a new workflow for missing, unknown or overlong resource paths", () => {
    expect(parseWorkflowRoute("/resources")).toEqual({ kind: "new" });
    expect(parseWorkflowRoute("/resources/secrets")).toEqual({ kind: "new" });
    expect(parseWorkflowRoute("/resources/credentials/extra")).toEqual({ kind: "new" });
  });

  it("builds resource section paths and compares routes", () => {
    expect(workflowRoutePath({ kind: "resources", section: "credentials" }))
      .toBe("/resources/credentials");
    expect(workflowRoutesEqual(
      { kind: "resources", section: "variables" },
      parseWorkflowRoute("/resources/variables"),
    )).toBe(true);
    expect(workflowRoutesEqual(
      { kind: "resources", section: "variables" },
      { kind: "resources", section: "credentials" },
    )).toBe(false);
  });

  it("builds canonical encoded paths and compares routes", () => {
    const route = { kind: "workflow", workflowId: "wf/1", nodeId: "节点 1" } as const;
    expect(workflowRoutePath(route)).toBe("/workflow/wf%2F1/%E8%8A%82%E7%82%B9%201");
    expect(workflowRoutesEqual(route, parseWorkflowRoute(workflowRoutePath(route)))).toBe(true);
    expect(workflowRoutePath({ kind: "new" })).toBe("/workflow/new");
    expect(workflowRoutePath({
      kind: "execution",
      workflowId: "wf/1",
      executionId: "run/1",
      nodeId: "节点 1",
    })).toBe("/workflow/wf%2F1/executions/run%2F1/%E8%8A%82%E7%82%B9%201");
  });
});
