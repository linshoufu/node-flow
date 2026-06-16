import type { JsonSchema, NodeType, WorkflowDocument, WorkflowEdge, WorkflowNode } from "../types";

type NodePosition = WorkflowNode["position"];

const LOOP_NODE_TYPES = new Set(["control.foreach", "control.while"]);

export function createEmptyWorkflow(): WorkflowDocument {
  return {
    id: prefixedId("wf"),
    name: "Untitled Workflow",
    version: 1,
    nodes: [],
    edges: [],
  };
}

export function createWorkflowNode(nodeType: NodeType, position: NodePosition): WorkflowNode {
  const node: WorkflowNode = {
    id: prefixedId("node"),
    type: nodeType.id,
    position,
    config: defaultsFromSchema(nodeType.configSchema),
  };

  if (LOOP_NODE_TYPES.has(nodeType.id)) {
    node.subflows = {
      body: {
        nodes: [],
        edges: [],
      },
    };
  }

  return node;
}

export function createWorkflowEdge(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string
): WorkflowEdge {
  return {
    id: prefixedId("edge"),
    source,
    sourceHandle,
    target,
    targetHandle,
  };
}

export function defaultsFromSchema(schema: JsonSchema | undefined): Record<string, unknown> {
  if (!schema?.properties) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(schema.properties).map(([key, propertySchema]) => [key, defaultForSchema(propertySchema)])
  );
}

function defaultForSchema(schema: JsonSchema): unknown {
  if ("default" in schema) {
    return schema.default;
  }

  if (schema.enum?.length) {
    return schema.enum[0];
  }

  const schemaType = Array.isArray(schema.type) ? schema.type.find((type) => type !== "null") : schema.type;

  switch (schemaType) {
    case "boolean":
      return false;
    case "integer":
    case "number":
      return 0;
    case "object":
      return {};
    case "array":
      return [];
    case "string":
      return "";
    default:
      return "";
  }
}

function prefixedId(prefix: string): string {
  return `${prefix}_${randomId()}`;
}

function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replace(/-/g, "");
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
