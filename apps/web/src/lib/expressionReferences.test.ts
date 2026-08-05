import { describe, expect, it } from "vitest";
import type { NodeType, RunEvent, WorkflowDocument } from "../types";
import { buildExpressionReferences } from "./expressionReferences";

const nodeTypes: NodeType[] = [
  nodeType("manual.trigger", {}, { success: {} }),
  nodeType("http.request", { body: {} }, { success: {}, error: {} }),
  nodeType("logic.set_variable", { input: {} }, { success: {} }),
  nodeType("data.csv_read", {}, { success: {}, error: {} }),
  nodeType("control.foreach", { input: {} }, { done: {}, error: {} }),
];

describe("buildExpressionReferences", () => {
  it("lists node output and variable references for the current workflow", () => {
    const workflow: WorkflowDocument = {
      id: "wf",
      name: "Workflow",
      version: 1,
      nodes: [
        node("start", "manual.trigger", {}, "开始"),
        node("request", "http.request", {}, "请求用户"),
        node("set_token", "logic.set_variable", { name: "token", value: "{{ nodes.request.outputs.success.body.token }}" }),
      ],
      edges: [],
    };

    expect(buildExpressionReferences({ workflow, nodeTypes })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: "node",
          expression: "{{ nodes.start.outputs.success }}",
          label: "开始 · 成功",
        }),
        expect.objectContaining({
          group: "node",
          expression: "{{ nodes.request.outputs.error }}",
          label: "请求用户 · 错误",
        }),
        expect.objectContaining({
          group: "variable",
          expression: "{{ variables.token }}",
          label: "token",
        }),
      ])
    );
  });

  it("uses output display names in the human-readable reference list", () => {
    const workflow: WorkflowDocument = {
      id: "wf",
      name: "Workflow",
      version: 1,
      nodes: [node("request", "http.request", {}, "读取用户")],
      edges: [],
    };
    const requestType = nodeType("http.request", {}, { success: { displayName: "响应数据" } });

    expect(buildExpressionReferences({ workflow, nodeTypes: [requestType] })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: "node",
          label: "读取用户 · 响应数据",
          expression: "{{ nodes.request.outputs.success }}",
          description: "读取用户 的“响应数据”输出",
        }),
      ]),
    );
  });

  it("lists configured dynamic output ports as expression references", () => {
    const switchType: NodeType = {
      ...nodeType("logic.switch", { input: {} }, { fallback: { displayName: "未匹配" } }),
      dynamicOutputs: {
        configKey: "rules",
        idKey: "id",
        labelKey: "label",
        output: { description: "命中的输入" },
      },
    };
    const workflow: WorkflowDocument = {
      id: "wf",
      name: "Workflow",
      version: 1,
      nodes: [node("switch", "logic.switch", { rules: [{ id: "matched", label: "命中目标" }] }, "路由")],
      edges: [],
    };

    expect(buildExpressionReferences({ workflow, nodeTypes: [switchType] })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expression: "{{ nodes.switch.outputs.matched }}",
          label: "路由 · 命中目标",
        }),
      ])
    );
  });

  it("lists workflow settings variables as vars references", () => {
    const workflow: WorkflowDocument = {
      id: "wf",
      name: "Workflow",
      version: 1,
      settings: {
        timeout_seconds: 600,
        variables: {
          baseUrl: "https://api.example.com",
          retry_count: 3,
          "invalid-name": "ignored",
        },
      },
      nodes: [node("start", "manual.trigger")],
      edges: [],
    };

    expect(buildExpressionReferences({ workflow, nodeTypes })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: "workflow-variable",
          expression: "{{ vars.baseUrl }}",
          label: "vars.baseUrl",
          description: "工作流变量 baseUrl",
        }),
        expect.objectContaining({
          group: "workflow-variable",
          expression: "{{ vars.retry_count }}",
          label: "vars.retry_count",
          description: "工作流变量 retry_count",
        }),
      ])
    );
    expect(buildExpressionReferences({ workflow, nodeTypes })).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expression: "{{ vars.invalid-name }}",
        }),
      ])
    );
  });

  it("lists project variables as project references", () => {
    const workflow: WorkflowDocument = {
      id: "wf",
      name: "Workflow",
      version: 1,
      nodes: [node("start", "manual.trigger")],
      edges: [],
    };

    expect(buildExpressionReferences({ workflow, nodeTypes, projectVariables: { base_url: "https://api.example.com" } })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: "project-variable",
          expression: "{{ project.base_url }}",
          label: "project.base_url",
          description: "项目变量 base_url",
        }),
      ])
    );
  });

  it("lists loop.item references inside a foreach body using CSV runtime headers", () => {
    const workflow: WorkflowDocument = {
      id: "wf",
      name: "Workflow",
      version: 1,
      nodes: [
        node("csv", "data.csv_read", { path: "examples/api-cases.csv" }),
        {
          ...node("each_row", "control.foreach", {
            items_expression: "{{ nodes.csv.outputs.success.rows }}",
          }),
          subflows: {
            body: {
              nodes: [node("request", "http.request", { url: "{{ loop.item.url }}" })],
              edges: [],
            },
          },
        },
      ],
      edges: [],
    };
    const runEvents: RunEvent[] = [
      {
        id: 1,
        run_id: "run_1",
        type: "node_succeeded",
        timestamp: "2026-06-23T00:00:00Z",
        node_id: "csv",
        scope: [],
        payload: {
          outputs: {
            success: {
              headers: ["name", "url"],
            },
          },
        },
      },
    ];

    expect(
      buildExpressionReferences({
        workflow,
        nodeTypes,
        editScope: [{ nodeId: "each_row", subflowName: "body" }],
        runEvents,
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: "loop",
          expression: "{{ loop.item }}",
          label: "loop.item",
        }),
        expect.objectContaining({
          group: "loop",
          expression: "{{ loop.item.url }}",
          label: "loop.item.url",
          description: "当前 CSV 行的 url 列",
        }),
      ])
    );
  });

  it("lists CSV item fields inside an item-loop body", () => {
    const workflow: WorkflowDocument = {
      id: "wf",
      name: "Workflow",
      version: 1,
      nodes: [
        node("csv", "data.csv_read", { path: "examples/api-cases.csv" }),
        {
          ...node("each_row", "control.each_item"),
          subflows: {
            body: {
              nodes: [node("request", "http.request", { url: "{{ loop.item.url }}" })],
              edges: [],
            },
          },
        },
      ],
      edges: [
        {
          id: "csv_items",
          source: "csv",
          sourceHandle: "items",
          target: "each_row",
          targetHandle: "items",
        },
      ],
    };
    const runEvents: RunEvent[] = [
      {
        id: 1,
        run_id: "run_1",
        type: "node_succeeded",
        timestamp: "2026-06-23T00:00:00Z",
        node_id: "csv",
        scope: [],
        payload: { outputs: { success: { headers: ["name", "url"] } } },
      },
    ];

    expect(
      buildExpressionReferences({
        workflow,
        nodeTypes,
        editScope: [{ nodeId: "each_row", subflowName: "body" }],
        runEvents,
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ expression: "{{ loop.item.url }}", label: "loop.item.url" }),
      ])
    );
  });

  it("adds nested field references from the latest node runtime outputs", () => {
    const workflow: WorkflowDocument = {
      id: "wf",
      name: "Workflow",
      version: 1,
      nodes: [node("request", "http.request", {}, "用户请求")],
      edges: [],
    };

    expect(
      buildExpressionReferences({
        workflow,
        nodeTypes,
        nodeRunStates: {
          request: {
            nodeId: "request",
            status: "succeeded",
            scopes: [[]],
            outputs: {
              success: {
                body: {
                  token: "abc",
                  user: { id: 42 },
                },
                status_code: 200,
              },
            },
          },
        },
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: "node",
          label: "用户请求 · 成功 · body.token",
          expression: "{{ nodes.request.outputs.success.body.token }}",
        }),
        expect.objectContaining({
          group: "node",
          label: "用户请求 · 成功 · body.user.id",
          expression: "{{ nodes.request.outputs.success.body.user.id }}",
        }),
        expect.objectContaining({
          group: "node",
          label: "用户请求 · 成功 · status_code",
          expression: "{{ nodes.request.outputs.success.status_code }}",
        }),
      ])
    );
  });
});

function nodeType(
  id: string,
  inputs: NodeType["inputs"],
  outputs: NodeType["outputs"]
): NodeType {
  return {
    id,
    name: id,
    category: "test",
    description: id,
    inputs,
    outputs,
    configSchema: { type: "object", properties: {} },
  };
}

function node(id: string, type: string, config: Record<string, unknown> = {}, label?: string) {
  return {
    id,
    type,
    ...(label ? { label } : {}),
    position: { x: 0, y: 0 },
    config,
  };
}
