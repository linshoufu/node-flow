import { describe, expect, it } from "vitest";
import type { NodeType, WorkflowDocument, WorkflowNode } from "../types";
import { buildNodeDisplayNames, workflowNodeDisplayName } from "./nodeDisplayNames";

describe("buildNodeDisplayNames", () => {
  const nodeTypes: NodeType[] = [
    nodeType({ id: "http.request", name: "HTTP 请求" }),
    nodeType({ id: "utility.log", name: "记录日志" }),
  ];

  it("prefers explicit node labels over legacy config labels and node type names", () => {
    const workflow = workflowWithNodes([
      {
        id: "request",
        type: "http.request",
        label: "登录请求",
        config: { label: "旧标题" },
      },
    ]);

    expect(buildNodeDisplayNames(workflow, nodeTypes)).toEqual({
      request: "登录请求",
    });
  });

  it("falls back through title, name, node type name, and node id", () => {
    const workflow = workflowWithNodes([
      {
        id: "title_node",
        type: "http.request",
        config: { title: "标题节点" },
      },
      {
        id: "name_node",
        type: "utility.log",
        config: { name: "名称节点" },
      },
      {
        id: "type_node",
        type: "http.request",
        config: {},
      },
      {
        id: "unknown_node",
        type: "missing.type",
        config: {},
      },
    ]);

    expect(buildNodeDisplayNames(workflow, nodeTypes)).toEqual({
      title_node: "标题节点",
      name_node: "名称节点",
      type_node: "HTTP 请求",
      unknown_node: "unknown_node",
    });
  });

  it("keeps legacy config labels readable when a node has no explicit label", () => {
    const node = {
      id: "request",
      type: "http.request",
      config: { label: "登录接口请求" },
    };

    expect(workflowNodeDisplayName({ ...node, position: { x: 0, y: 0 } }, nodeTypes[0])).toBe("登录接口请求");
  });

  it("ignores blank configured names", () => {
    const workflow = workflowWithNodes([
      {
        id: "request",
        type: "http.request",
        config: { label: "   ", title: "", name: "  " },
      },
    ]);

    expect(buildNodeDisplayNames(workflow, nodeTypes)).toEqual({
      request: "HTTP 请求",
    });
  });

  it("uses node type display names before technical names", () => {
    const workflow = workflowWithNodes([
      {
        id: "manual",
        type: "trigger.manual",
        config: {},
      },
    ]);
    const triggerType = nodeType({
      id: "trigger.manual",
      name: "Manual Trigger",
      displayName: "手动触发",
    });

    expect(buildNodeDisplayNames(workflow, [triggerType])).toEqual({
      manual: "手动触发",
    });
  });

  it("resolves a single workflow node display name for canvas and panel callers", () => {
    const node: WorkflowNode = {
      id: "request",
      type: "http.request",
      position: { x: 0, y: 0 },
      config: { label: "登录接口请求" },
    };

    expect(workflowNodeDisplayName(node, nodeTypes[0])).toBe("登录接口请求");
    expect(workflowNodeDisplayName({ ...node, config: {} }, nodeTypes[0])).toBe("HTTP 请求");
    expect(workflowNodeDisplayName({ ...node, config: {}, type: "missing.type" })).toBe("request");
  });
});

function workflowWithNodes(
  nodes: Array<{ id: string; type: string; label?: string; config: Record<string, unknown> }>
): Pick<WorkflowDocument, "nodes"> {
  return {
    nodes: nodes.map((node, index) => ({
      ...node,
      position: { x: index * 100, y: index * 80 },
    })),
  };
}

function nodeType(overrides: Pick<NodeType, "id" | "name"> & Partial<Pick<NodeType, "displayName">>): NodeType {
  return {
    ...overrides,
    category: "操作",
    description: "",
    inputs: {},
    outputs: {},
    configSchema: { type: "object", properties: {} },
  };
}
