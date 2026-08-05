import { describe, expect, it, vi } from "vitest";
import type { NodeType } from "../types";
import {
  createEmptyWorkflow,
  duplicateWorkflowNodes,
  duplicateWorkflowNode,
  duplicateWorkflowDraft,
  createWorkflowEdge,
  createWorkflowNode,
  defaultsFromSchema,
  getEditableWorkflow,
  normalizeWorkflowDocument,
  nextWorkflowNodePosition,
  updateEditableWorkflow,
  workflowTimeoutSeconds,
  workflowErrorWorkflowId,
  workflowMaxConcurrentRuns,
  workflowVariables,
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
  it("creates a duplicated draft with a new workflow id and reset version", () => {
    const original = {
      id: "wf_original",
      name: "CSV 参数化接口测试",
      version: 7,
      nodes: [
        {
          id: "node_1",
          type: "manual.trigger",
          typeVersion: 1,
          position: { x: 10, y: 20 },
          config: { payload: { hello: "world" } },
        },
      ],
      edges: [],
      settings: { timeout_seconds: 30 },
    };

    const draft = duplicateWorkflowDraft(original);

    expect(draft.id).not.toBe("wf_original");
    expect(draft.id).toMatch(/^wf_/);
    expect(draft.name).toBe("CSV 参数化接口测试 副本");
    expect(draft.version).toBe(1);
    expect(draft.active).toBe(false);
    expect(draft.nodes).toEqual(original.nodes);
    expect(draft.nodes).not.toBe(original.nodes);
  });

  it("normalizes workflow settings for older documents", () => {
    const workflow = {
      id: "wf_legacy",
      name: "Legacy Workflow",
      version: 3,
      nodes: [],
      edges: [],
    };

    expect(normalizeWorkflowDocument(workflow)).toEqual({
      ...workflow,
      active: true,
      description: "",
      tags: [],
      annotations: [],
      settings: {
        timeout_seconds: 600,
        variables: {},
        error_workflow_id: null,
        max_concurrent_runs: null,
        environment_id: "default",
      },
    });
  });

  it("preserves parent subflow annotations when updating a nested subflow", () => {
    const innerNode = {
      id: "inner-loop",
      type: "control.foreach",
      typeVersion: 1,
      position: { x: 20, y: 20 },
      config: {},
      subflows: {
        body: {
          nodes: [],
          edges: [],
          annotations: [],
        },
      },
    };
    const outerNode = {
      id: "outer-loop",
      type: "control.foreach",
      typeVersion: 1,
      position: { x: 10, y: 10 },
      config: {},
      subflows: {
        body: {
          nodes: [innerNode],
          edges: [],
          annotations: [
            {
              id: "outer-note",
              content: "keep parent note",
              position: { x: 30, y: 40 },
              width: 320,
              height: 180,
              color: "yellow" as const,
            },
          ],
        },
      },
    };
    const original = {
      ...createEmptyWorkflow(),
      nodes: [outerNode],
    };

    const updated = updateEditableWorkflow(
      original,
      [
        { nodeId: "outer-loop", subflowName: "body" },
        { nodeId: "inner-loop", subflowName: "body" },
      ],
      {
        nodes: [
          {
            id: "nested-node",
            type: "test.node",
            typeVersion: 1,
            position: { x: 50, y: 50 },
            config: {},
          },
        ],
        edges: [],
        annotations: [],
      },
    );

    expect(updated.nodes[0].subflows?.body.annotations).toEqual(
      outerNode.subflows.body.annotations,
    );
    expect(
      updated.nodes[0].subflows?.body.nodes[0].subflows?.body.nodes,
    ).toHaveLength(1);
  });

  it("creates new workflows inactive while preserving legacy workflow activation", () => {
    expect(createEmptyWorkflow().active).toBe(false);
    expect(
      normalizeWorkflowDocument({ id: "wf_legacy_active", name: "Legacy", version: 1, nodes: [], edges: [] }).active
    ).toBe(true);
  });

  it("creates an empty body subflow for an item loop", () => {
    const loop = createWorkflowNode(
      nodeType({
        id: "control.each_item",
        configSchema: {
          type: "object",
          properties: {
            max_items: { type: "integer", default: 100 },
            continue_on_error: { type: "boolean", default: false },
          },
        },
      }),
      { x: 24, y: 48 }
    );

    expect(loop.config).toEqual({ max_items: 100, continue_on_error: false });
    expect(loop.subflows).toEqual({ body: { nodes: [], edges: [], annotations: [] } });
  });

  it("normalizes workflow metadata for legacy documents and cleans tags", () => {
    const normalized = normalizeWorkflowDocument({
      id: "wf_legacy_metadata",
      name: "Legacy workflow",
      version: 1,
      nodes: [],
      edges: [],
      description: 42,
      tags: [" release ", "automation", "release", "", 12],
    } as unknown as import("../types").WorkflowDocument);

    expect(normalized.description).toBe("");
    expect(normalized.tags).toEqual(["release", "automation"]);
  });

  it("keeps trimmed node notes when normalizing imported workflows", () => {
    const normalized = normalizeWorkflowDocument({
      id: "wf_imported_notes",
      name: "Imported notes",
      version: 1,
      nodes: [
        {
          id: "request",
          type: "http.request",
          position: { x: 0, y: 0 },
          config: {},
          notes: "  仅用于测试环境。  ",
        },
      ],
      edges: [],
    } as unknown as import("../types").WorkflowDocument);

    expect(normalized.nodes[0].notes).toBe("仅用于测试环境。");
  });

  it("keeps canvas annotations at the root and inside subflows when normalizing imports", () => {
    const normalized = normalizeWorkflowDocument({
      id: "wf_annotations",
      name: "Annotations",
      version: 1,
      annotations: [
        {
          id: "root_note",
          content: "  Prepare input.  ",
          position: { x: 20, y: 30 },
          width: 360,
          height: 180,
          color: "yellow",
        },
      ],
      nodes: [
        {
          id: "loop",
          type: "control.foreach",
          position: { x: 0, y: 0 },
          config: {},
          subflows: {
            body: {
              nodes: [],
              edges: [],
              annotations: [
                {
                  id: "body_note",
                  content: "  Process each item.  ",
                  position: { x: 40, y: 50 },
                  width: 320,
                  height: 160,
                  color: "blue",
                },
              ],
            },
          },
        },
      ],
      edges: [],
    } as unknown as import("../types").WorkflowDocument);

    expect(normalized.annotations).toEqual([
      {
        id: "root_note",
        content: "Prepare input.",
        position: { x: 20, y: 30 },
        width: 360,
        height: 180,
        color: "yellow",
      },
    ]);
    expect(normalized.nodes[0].subflows?.body.annotations?.[0]?.content).toBe("Process each item.");
  });

  it("normalizes legacy workflow nodes to type version one", () => {
    const workflow = {
      id: "wf_legacy_nodes",
      name: "Legacy nodes",
      version: 1,
      nodes: [
        {
          id: "node_1",
          type: "test.node",
          position: { x: 10, y: 20 },
          config: {},
        },
      ],
      edges: [],
    };

    expect(normalizeWorkflowDocument(workflow).nodes[0].typeVersion).toBe(1);
  });

  it("keeps existing workflow settings while filling missing defaults", () => {
    const workflow = {
      id: "wf_partial_settings",
      name: "Partial Settings",
      version: 3,
      nodes: [],
      edges: [],
      settings: {
        timeout_seconds: 30,
      },
    };

    expect(normalizeWorkflowDocument(workflow).settings).toEqual({
      timeout_seconds: 30,
      variables: {},
      error_workflow_id: null,
      max_concurrent_runs: null,
      environment_id: "default",
    });
    expect(workflowTimeoutSeconds(workflow)).toBe(30);
    expect(workflowVariables(workflow)).toEqual({});
  });

  it("normalizes and exposes a workflow concurrent run limit", () => {
    const workflow = {
      id: "wf_concurrency",
      name: "Concurrency workflow",
      version: 1,
      nodes: [],
      edges: [],
      settings: {
        timeout_seconds: 30,
        max_concurrent_runs: 2,
      },
    };

    expect(normalizeWorkflowDocument(workflow).settings?.max_concurrent_runs).toBe(2);
    expect(workflowMaxConcurrentRuns(workflow)).toBe(2);
    expect(workflowMaxConcurrentRuns({ ...workflow, settings: { timeout_seconds: 30, max_concurrent_runs: 65 } })).toBe(
      null
    );
  });

  it("normalizes and exposes an error workflow reference", () => {
    const workflow = {
      id: "wf_with_error_handler",
      name: "Error handler user",
      version: 1,
      nodes: [],
      edges: [],
      settings: { timeout_seconds: 30, error_workflow_id: "  wf_error_handler  " },
    };

    expect(normalizeWorkflowDocument(workflow).settings?.error_workflow_id).toBe("wf_error_handler");
    expect(workflowErrorWorkflowId(workflow)).toBe("wf_error_handler");
  });

  it("normalizes incomplete imported workflow nodes and subflows", () => {
    const workflow = {
      id: "wf_imported",
      name: "Imported",
      version: 1,
      nodes: [
        {
          id: "loop",
          type: "control.foreach",
          position: { x: 0, y: 0 },
          subflows: {
            body: {
              nodes: [
                {
                  id: "log",
                  type: "utility.log",
                  position: { x: 120, y: 40 },
                },
              ],
            },
          },
        },
        {
          id: "request",
          type: "http.request",
          position: { x: 240, y: 0 },
        },
      ],
    } as unknown as WorkflowDocument;

    expect(normalizeWorkflowDocument(workflow)).toMatchObject({
      id: "wf_imported",
      nodes: [
        {
          id: "loop",
          config: {},
          subflows: {
            body: {
              nodes: [
                {
                  id: "log",
                  config: {},
                },
              ],
              edges: [],
            },
          },
        },
        {
          id: "request",
          config: {},
        },
      ],
      edges: [],
      settings: {
        timeout_seconds: 600,
        variables: {},
      },
    });
  });

  it("adds an empty body subflow for legacy loop nodes", () => {
    const workflow = {
      id: "wf_legacy_loop",
      name: "Legacy Loop",
      version: 1,
      nodes: [
        {
          id: "loop",
          type: "control.while",
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
      edges: [],
    } as WorkflowDocument;

    expect(normalizeWorkflowDocument(workflow).nodes[0].subflows).toEqual({
      body: {
        nodes: [],
        edges: [],
        annotations: [],
      },
    });
  });

  it("normalizes invalid imported node positions", () => {
    const workflow = {
      id: "wf_bad_positions",
      name: "Bad Positions",
      version: 1,
      nodes: [
        {
          id: "missing_position",
          type: "utility.log",
          config: {},
        },
        {
          id: "partial_position",
          type: "http.request",
          position: { x: 240 },
          config: {},
        },
        {
          id: "invalid_position",
          type: "data.csv_read",
          position: { x: Number.NaN, y: "80" },
          config: {},
        },
      ],
      edges: [],
    } as unknown as WorkflowDocument;

    expect(normalizeWorkflowDocument(workflow).nodes.map((node) => node.position)).toEqual([
      { x: 0, y: 0 },
      { x: 240, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it("duplicates older workflows as normalized drafts", () => {
    const original = {
      id: "wf_original",
      name: "Legacy",
      version: 4,
      nodes: [],
      edges: [],
    };

    const draft = duplicateWorkflowDraft(original);

    expect(draft.settings).toEqual({
      timeout_seconds: 600,
      variables: {},
      error_workflow_id: null,
      max_concurrent_runs: null,
      environment_id: "default",
    });
  });

  it("creates an empty workflow document", () => {
    const workflow = createEmptyWorkflow();

    expect(workflow.id).toMatch(/^wf_/);
    expect(workflow.name).toBe("未命名工作流");
    expect(workflow.version).toBe(1);
    expect(workflow.nodes).toEqual([]);
    expect(workflow.edges).toEqual([]);
    expect(workflow.settings).toEqual({
      timeout_seconds: 600,
      variables: {},
      error_workflow_id: null,
      max_concurrent_runs: null,
      environment_id: "default",
    });
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

  it("preserves list defaults for dynamic route node configuration", () => {
    const node = createWorkflowNode(
      nodeType({
        id: "logic.switch",
        dynamicOutputs: {
          configKey: "rules",
          idKey: "id",
          labelKey: "label",
          output: {},
          defaultItems: [
            { id: "route_1", label: "匹配值 1", value: "value_1" },
            { id: "route_2", label: "匹配值 2", value: "value_2" },
          ],
        },
        configSchema: {
          type: "object",
          properties: {
            rules: {
              type: "array",
              default: [
                { id: "route_1", label: "匹配值 1", value: "value_1" },
                { id: "route_2", label: "匹配值 2", value: "value_2" },
              ],
            },
          },
        },
      }),
      { x: 0, y: 0 }
    );

    expect(node.config).toEqual({
      rules: [
        { id: "route_1", label: "匹配值 1", value: "value_1" },
        { id: "route_2", label: "匹配值 2", value: "value_2" },
      ],
    });
  });

  it("preserves list defaults for dynamic input node configuration", () => {
    const node = createWorkflowNode(
      nodeType({
        id: "data.collect",
        dynamicInputs: {
          configKey: "sources",
          idKey: "id",
          labelKey: "label",
          input: { required: true },
          defaultItems: [
            { id: "input_1", label: "输入 1" },
            { id: "input_2", label: "输入 2" },
          ],
        },
        configSchema: { type: "object", properties: { sources: { type: "array", default: [] } } },
      }),
      { x: 0, y: 0 }
    );

    expect(node.config).toEqual({
      sources: [
        { id: "input_1", label: "输入 1" },
        { id: "input_2", label: "输入 2" },
      ],
    });
  });

  it("creates config defaults from composed JSON schema fields", () => {
    expect(
      defaultsFromSchema({
        type: "object",
        properties: {
          optionalText: { anyOf: [{ type: "string", default: "token" }, { type: "null" }] },
          optionalCount: { oneOf: [{ type: "integer" }, { type: "null" }] },
          mergedLabel: { allOf: [{ type: "string" }, { default: "fast" }] },
        },
      })
    ).toEqual({
      optionalText: "token",
      optionalCount: 0,
      mergedLabel: "fast",
    });
  });
  it("creates config defaults from local $defs references", () => {
    expect(
      defaultsFromSchema({
        type: "object",
        $defs: {
          Endpoint: { type: "string", default: "https://api.example.com" },
        },
        properties: {
          endpoint: { $ref: "#/$defs/Endpoint" },
        },
      })
    ).toEqual({
      endpoint: "https://api.example.com",
    });
  });
  it("creates a workflow node from node type metadata", () => {
    const node = createWorkflowNode(nodeType({ version: 3 }), { x: 120, y: 240 });

    expect(node).toMatchObject({
      type: "test.node",
      typeVersion: 3,
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

  it("places nodes added from the palette on a readable canvas grid", () => {
    expect(nextWorkflowNodePosition(0)).toEqual({ x: 80, y: 80 });
    expect(nextWorkflowNodePosition(1)).toEqual({ x: 340, y: 80 });
    expect(nextWorkflowNodePosition(2)).toEqual({ x: 600, y: 80 });
    expect(nextWorkflowNodePosition(3)).toEqual({ x: 80, y: 280 });
  });

  it("duplicates nested workflow content with fresh local node, edge, and annotation ids", () => {
    const source = {
      id: "loop_source",
      type: "control.foreach",
      label: "处理每条记录",
      position: { x: 80, y: 120 },
      config: { items_expression: "{{ nodes.csv.outputs.success.rows }}" },
      subflows: {
        body: {
          nodes: [
            { id: "request", type: "http.request", position: { x: 20, y: 30 }, config: { url: "https://example.test" } },
            { id: "assert", type: "assert.status_code", position: { x: 260, y: 30 }, config: { expected: 200 } },
          ],
          edges: [
            { id: "body_edge", source: "request", sourceHandle: "success", target: "assert", targetHandle: "input" },
          ],
          annotations: [
            {
              id: "body_note",
              content: "接口校验",
              position: { x: 12, y: 150 },
              width: 320,
              height: 180,
              color: "blue" as const,
            },
          ],
        },
      },
    };

    const duplicate = duplicateWorkflowNode(source, { x: 40, y: 60 });
    const duplicateBody = duplicate.subflows?.body;

    expect(duplicate).toMatchObject({
      id: expect.stringMatching(/^node_/),
      type: source.type,
      label: source.label,
      position: { x: 120, y: 180 },
      config: source.config,
    });
    expect(duplicate.id).not.toBe(source.id);
    expect(duplicateBody?.nodes.map((node) => node.id)).not.toEqual(["request", "assert"]);
    expect(duplicateBody?.edges).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^edge_/),
        source: duplicateBody?.nodes[0].id,
        target: duplicateBody?.nodes[1].id,
      }),
    ]);
    expect(duplicateBody?.annotations).toEqual([
      expect.objectContaining({ id: expect.stringMatching(/^annotation_/), content: "接口校验" }),
    ]);
    expect(duplicateBody?.annotations?.[0].id).not.toBe("body_note");
  });

  it("duplicates a selected graph segment and keeps only the connections within that selection", () => {
    const nodes = [
      { id: "start", type: "manual.trigger", position: { x: 0, y: 0 }, config: {} },
      { id: "request", type: "http.request", position: { x: 240, y: 0 }, config: {} },
      { id: "report", type: "test.write_report", position: { x: 480, y: 0 }, config: {} },
    ];
    const edges = [
      { id: "start_request", source: "start", sourceHandle: "success", target: "request", targetHandle: "input" },
      { id: "request_report", source: "request", sourceHandle: "success", target: "report", targetHandle: "input" },
    ];

    const duplicate = duplicateWorkflowNodes(nodes, edges, ["start", "request"], { x: 60, y: 80 });

    expect(duplicate.nodes).toHaveLength(2);
    expect(duplicate.nodes.map((node) => node.position)).toEqual([
      { x: 60, y: 80 },
      { x: 300, y: 80 },
    ]);
    expect(duplicate.nodes.map((node) => node.id)).not.toEqual(["start", "request"]);
    expect(duplicate.edges).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^edge_/),
        source: duplicate.nodes[0].id,
        target: duplicate.nodes[1].id,
      }),
    ]);
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
      annotations: [],
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
      annotations: [],
    });
    expect(getEditableWorkflow(workflow, [{ nodeId: "loop-1", subflowName: "missing" }])).toEqual({
      nodes: [],
      edges: [],
      annotations: [],
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
        annotations: [],
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
