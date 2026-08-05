import { describe, expect, it } from "vitest";
import type { WorkflowEdge, WorkflowNode } from "../types";
import {
  createWorkflowNodeClipboard,
  parseWorkflowNodeClipboard,
  pasteWorkflowNodeClipboard,
  serializeWorkflowNodeClipboard,
} from "./workflowClipboard";

const nodes: WorkflowNode[] = [
  { id: "start", type: "manual.trigger", position: { x: 40, y: 60 }, config: { payload: { order: 1 } } },
  { id: "request", type: "http.request", position: { x: 280, y: 60 }, config: { url: "https://example.test" } },
  { id: "report", type: "utility.log", position: { x: 520, y: 60 }, config: {} },
];

const edges: WorkflowEdge[] = [
  { id: "start-request", source: "start", sourceHandle: "success", target: "request", targetHandle: "input" },
  { id: "request-report", source: "request", sourceHandle: "success", target: "report", targetHandle: "input" },
];

describe("workflow node clipboard", () => {
  it("copies only selected nodes and their internal edges", () => {
    const clipboard = createWorkflowNodeClipboard(nodes, edges, ["start", "request"]);

    expect(clipboard).toEqual({
      format: "node-flow.nodes",
      version: 1,
      nodes: [nodes[0], nodes[1]],
      edges: [edges[0]],
    });
  });

  it("pastes fresh node and edge IDs with a position offset", () => {
    const clipboard = createWorkflowNodeClipboard(nodes, edges, ["start", "request"]);
    const pasted = pasteWorkflowNodeClipboard(clipboard, { x: 48, y: 36 });

    expect(pasted.nodes).toHaveLength(2);
    expect(pasted.nodes.map((node) => node.id)).not.toContain("start");
    expect(pasted.nodes.map((node) => node.id)).not.toContain("request");
    expect(pasted.nodes.map((node) => node.position)).toEqual([{ x: 88, y: 96 }, { x: 328, y: 96 }]);
    expect(pasted.nodes[0].config).toEqual({ payload: { order: 1 } });
    expect(pasted.nodes[0].config).not.toBe(nodes[0].config);
    expect(pasted.edges).toHaveLength(1);
    expect(pasted.edges[0]).toMatchObject({ sourceHandle: "success", targetHandle: "input" });
    expect(pasted.edges[0].id).not.toBe("start-request");
    expect(pasted.edges[0].source).toBe(pasted.nodes[0].id);
    expect(pasted.edges[0].target).toBe(pasted.nodes[1].id);
  });

  it("round-trips the portable clipboard format and rejects unrelated text", () => {
    const clipboard = createWorkflowNodeClipboard(nodes, edges, ["start", "request"]);

    expect(parseWorkflowNodeClipboard(serializeWorkflowNodeClipboard(clipboard))).toEqual(clipboard);
    expect(parseWorkflowNodeClipboard("not a Node Flow clipboard")).toBeNull();
    expect(parseWorkflowNodeClipboard(JSON.stringify({ format: "node-flow.nodes", version: 2, nodes: [], edges: [] }))).toBeNull();
  });
});
