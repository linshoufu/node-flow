import { describe, expect, it, vi } from "vitest";
import type { NodeType } from "../types";
import {
  createEmptyWorkflow,
  createWorkflowEdge,
  createWorkflowNode,
  defaultsFromSchema,
  getEditableWorkflow,
  updateEditableWorkflow,
} from "./workflow";

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

  it("gets root nodes and edges when edit scope is empty", () => {
    const node = createWorkflowNode(nodeType(), { x: 0, y: 0 });
    const edge = createWorkflowEdge("source-node", "result", "target-node", "input");
    const workflow = {
      ...createEmptyWorkflow(),
      nodes: [node],
      edges: [edge],
    };

    expect(getEditableWorkflow(workflow, undefined)).toEqual({
      nodes: [node],
      edges: [edge],
    });
  });

  it("gets body subflow nodes and edges for scoped loop editing", () => {
    const bodyNode = createWorkflowNode(nodeType({ id: "action.log" }), { x: 40, y: 60 });
    const bodyEdge = createWorkflowEdge("body-source", "result", "body-target", "input");
    const loopNode = {
      ...createWorkflowNode(nodeType({ id: "control.foreach" }), { x: 0, y: 0 }),
      id: "loop-1",
      subflows: {
        body: {
          nodes: [bodyNode],
          edges: [bodyEdge],
        },
      },
    };
    const workflow = {
      ...createEmptyWorkflow(),
      nodes: [loopNode],
      edges: [],
    };

    expect(getEditableWorkflow(workflow, [{ nodeId: "loop-1", subflowName: "body" }])).toEqual({
      nodes: [bodyNode],
      edges: [bodyEdge],
    });
  });

  it("returns an empty editable workflow when scoped subflow is missing", () => {
    const workflow = {
      ...createEmptyWorkflow(),
      nodes: [{ ...createWorkflowNode(nodeType({ id: "control.foreach" }), { x: 0, y: 0 }), id: "loop-1" }],
      edges: [],
    };

    expect(getEditableWorkflow(workflow, [{ nodeId: "missing", subflowName: "body" }])).toEqual({
      nodes: [],
      edges: [],
    });
    expect(getEditableWorkflow(workflow, [{ nodeId: "loop-1", subflowName: "missing" }])).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it("updates root nodes and edges when edit scope is empty", () => {
    const originalNode = createWorkflowNode(nodeType(), { x: 0, y: 0 });
    const nextNode = createWorkflowNode(nodeType(), { x: 100, y: 120 });
    const nextEdge = createWorkflowEdge("source-node", "result", "target-node", "input");
    const workflow = {
      ...createEmptyWorkflow(),
      nodes: [originalNode],
      edges: [],
    };

    expect(updateEditableWorkflow(workflow, undefined, { nodes: [nextNode], edges: [nextEdge] })).toEqual({
      ...workflow,
      nodes: [nextNode],
      edges: [nextEdge],
    });
  });

  it("updates a body subflow without changing root nodes and edges", () => {
    const nextBodyNode = createWorkflowNode(nodeType({ id: "action.log" }), { x: 40, y: 60 });
    const nextBodyEdge = createWorkflowEdge("body-source", "result", "body-target", "input");
    const rootEdge = createWorkflowEdge("root-source", "result", "root-target", "input");
    const loopNode = {
      ...createWorkflowNode(nodeType({ id: "control.while" }), { x: 0, y: 0 }),
      id: "loop-1",
      subflows: {
        body: {
          nodes: [],
          edges: [],
        },
      },
    };
    const workflow = {
      ...createEmptyWorkflow(),
      nodes: [loopNode],
      edges: [rootEdge],
    };

    const updated = updateEditableWorkflow(workflow, [{ nodeId: "loop-1", subflowName: "body" }], {
      nodes: [nextBodyNode],
      edges: [nextBodyEdge],
    });

    expect(updated.edges).toEqual([rootEdge]);
    expect(updated.nodes).toEqual([
      {
        ...loopNode,
        subflows: {
          body: {
            nodes: [nextBodyNode],
            edges: [nextBodyEdge],
          },
        },
      },
    ]);
  });

  it("gets a nested body subflow by walking the edit scope path", () => {
    const nestedBodyNode = createWorkflowNode(nodeType({ id: "action.log" }), { x: 80, y: 90 });
    const whileNode = {
      ...createWorkflowNode(nodeType({ id: "control.while" }), { x: 40, y: 60 }),
      id: "while-1",
      subflows: {
        body: {
          nodes: [nestedBodyNode],
          edges: [],
        },
      },
    };
    const foreachNode = {
      ...createWorkflowNode(nodeType({ id: "control.foreach" }), { x: 0, y: 0 }),
      id: "foreach-1",
      subflows: {
        body: {
          nodes: [whileNode],
          edges: [],
        },
      },
    };
    const workflow = {
      ...createEmptyWorkflow(),
      nodes: [foreachNode],
      edges: [],
    };

    expect(
      getEditableWorkflow(workflow, [
        { nodeId: "foreach-1", subflowName: "body" },
        { nodeId: "while-1", subflowName: "body" },
      ])
    ).toEqual({
      nodes: [nestedBodyNode],
      edges: [],
    });
  });

  it("updates a nested body subflow without replacing unrelated subflows", () => {
    const nextNestedBodyNode = createWorkflowNode(nodeType({ id: "action.log" }), { x: 120, y: 130 });
    const siblingBodyNode = createWorkflowNode(nodeType({ id: "action.sibling" }), { x: 140, y: 150 });
    const whileNode = {
      ...createWorkflowNode(nodeType({ id: "control.while" }), { x: 40, y: 60 }),
      id: "while-1",
      subflows: {
        body: {
          nodes: [],
          edges: [],
        },
        fallback: {
          nodes: [siblingBodyNode],
          edges: [],
        },
      },
    };
    const foreachNode = {
      ...createWorkflowNode(nodeType({ id: "control.foreach" }), { x: 0, y: 0 }),
      id: "foreach-1",
      subflows: {
        body: {
          nodes: [whileNode],
          edges: [],
        },
      },
    };
    const workflow = {
      ...createEmptyWorkflow(),
      nodes: [foreachNode],
      edges: [],
    };

    const updated = updateEditableWorkflow(
      workflow,
      [
        { nodeId: "foreach-1", subflowName: "body" },
        { nodeId: "while-1", subflowName: "body" },
      ],
      {
        nodes: [nextNestedBodyNode],
        edges: [],
      }
    );

    expect(updated.nodes[0].subflows?.body?.nodes[0]).toMatchObject({
      id: "while-1",
      subflows: {
        body: {
          nodes: [nextNestedBodyNode],
          edges: [],
        },
        fallback: {
          nodes: [siblingBodyNode],
          edges: [],
        },
      },
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
