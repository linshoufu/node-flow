import { describe, expect, it, vi } from "vitest";
import type { NodeType } from "../types";
import { createEmptyWorkflow, createWorkflowEdge, createWorkflowNode, defaultsFromSchema } from "./workflow";

function nodeType(overrides: Partial<NodeType> = {}): NodeType {
  return {
    id: "test.node",
    name: "Test Node",
    category: "test",
    description: "A test node",
    inputs: {},
    outputs: {},
    configSchema: {
      type: "object",
      properties: {
        explicit: { type: "string", default: "from-default" },
        choice: { type: "string", enum: ["first", "second"] },
        flag: { type: "boolean" },
        count: { type: "integer" },
        ratio: { type: "number" },
        label: { type: "string" },
        payload: { type: "object", additionalProperties: true },
        items: { type: "array", items: { type: "string" } },
      },
    },
    ...overrides,
  };
}

describe("workflow helpers", () => {
  it("creates an empty workflow document", () => {
    const workflow = createEmptyWorkflow();

    expect(workflow.id).toMatch(/^wf_/);
    expect(workflow.name).toBe("Untitled Workflow");
    expect(workflow.version).toBe(1);
    expect(workflow.nodes).toEqual([]);
    expect(workflow.edges).toEqual([]);
  });

  it("creates config defaults from JSON schema fields", () => {
    expect(defaultsFromSchema(nodeType().configSchema)).toEqual({
      explicit: "from-default",
      choice: "first",
      flag: false,
      count: 0,
      ratio: 0,
      label: "",
      payload: {},
      items: [],
    });
  });

  it("creates a workflow node from node type metadata", () => {
    const node = createWorkflowNode(nodeType(), { x: 120, y: 240 });

    expect(node).toMatchObject({
      type: "test.node",
      position: { x: 120, y: 240 },
      config: {
        explicit: "from-default",
        choice: "first",
        flag: false,
        count: 0,
        ratio: 0,
        label: "",
        payload: {},
        items: [],
      },
    });
    expect(node.id).toMatch(/^node_/);
  });

  it("creates workflow edges with generated IDs", () => {
    const edge = createWorkflowEdge("source-node", "result", "target-node", "input");

    expect(edge).toEqual({
      id: expect.stringMatching(/^edge_/),
      source: "source-node",
      sourceHandle: "result",
      target: "target-node",
      targetHandle: "input",
    });
  });

  it.each(["control.foreach", "control.while"])("creates a body subflow for %s", (id) => {
    const node = createWorkflowNode(nodeType({ id }), { x: 0, y: 0 });

    expect(node.subflows).toEqual({
      body: {
        nodes: [],
        edges: [],
      },
    });
  });

  it("falls back when crypto.randomUUID is unavailable", () => {
    const originalCrypto = globalThis.crypto;

    vi.stubGlobal("crypto", {});
    try {
      expect(createEmptyWorkflow().id).toMatch(/^wf_/);
      expect(createWorkflowNode(nodeType(), { x: 0, y: 0 }).id).toMatch(/^node_/);
    } finally {
      vi.stubGlobal("crypto", originalCrypto);
    }
  });
});
