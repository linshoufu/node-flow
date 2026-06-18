import type { JsonSchema, NodeType, WorkflowDocument, WorkflowEdge, WorkflowNode, WorkflowSubflow } from "../types";

type NodePosition = WorkflowNode["position"];
export type EditScopeStep = { nodeId: string; subflowName: string };
export type EditScope = EditScopeStep[] | undefined;

const LOOP_NODE_TYPES = new Set(["control.foreach", "control.while"]);

export function createEmptyWorkflow(): WorkflowDocument {
  return {
    id: prefixedId("wf"),
    name: "未命名工作流",
    version: 1,
    nodes: [],
    edges: [],
    settings: {
      timeout_seconds: 600,
    },
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

export function getEditableWorkflow(workflow: WorkflowDocument, scope: EditScope): WorkflowSubflow {
  let current: WorkflowSubflow = {
    nodes: workflow.nodes,
    edges: workflow.edges,
  };

  for (const step of scope ?? []) {
    const next = current.nodes.find((node) => node.id === step.nodeId)?.subflows?.[step.subflowName];
    if (!next) {
      return {
        nodes: [],
        edges: [],
      };
    }
    current = next;
  }

  return current;
}

export function updateEditableWorkflow(
  workflow: WorkflowDocument,
  scope: EditScope,
  next: WorkflowSubflow
): WorkflowDocument {
  const path = scope ?? [];

  if (path.length === 0) {
    return {
      ...workflow,
      nodes: next.nodes,
      edges: next.edges,
    };
  }

  const [updatedRoot, didUpdate] = updateSubflowAtPath(
    {
      nodes: workflow.nodes,
      edges: workflow.edges,
    },
    path,
    next
  );

  return didUpdate
    ? {
        ...workflow,
        nodes: updatedRoot.nodes,
        edges: updatedRoot.edges,
      }
    : workflow;
}

function updateSubflowAtPath(
  current: WorkflowSubflow,
  path: EditScopeStep[],
  next: WorkflowSubflow
): [WorkflowSubflow, boolean] {
  const [step, ...rest] = path;
  const nodeIndex = current.nodes.findIndex((node) => node.id === step.nodeId);

  if (nodeIndex === -1) {
    return [current, false];
  }

  const node = current.nodes[nodeIndex];
  const currentChild = node.subflows?.[step.subflowName];
  if (rest.length > 0 && !currentChild) {
    return [current, false];
  }

  const [updatedChild, didUpdate] =
    rest.length === 0
      ? [next, true]
      : updateSubflowAtPath(
          currentChild ?? {
            nodes: [],
            edges: [],
          },
          rest,
          next
        );

  if (!didUpdate) {
    return [current, false];
  }

  const updatedNode: WorkflowNode = {
    ...node,
    subflows: {
      ...node.subflows,
      [step.subflowName]: updatedChild,
    },
  };
  const updatedNodes = [...current.nodes];
  updatedNodes[nodeIndex] = updatedNode;

  return [
    {
      nodes: updatedNodes,
      edges: current.edges,
    },
    true,
  ];
}

export function scopeKey(scope: EditScope): string {
  return (scope ?? []).map((step) => `${step.nodeId}.${step.subflowName}`).join("/");
}

export function scopeLabel(workflow: WorkflowDocument, scope: EditScope, nodeTypes: NodeType[]): string {
  if (!scope?.length) {
    return "";
  }

  const labels: string[] = [];
  let current: WorkflowSubflow = {
    nodes: workflow.nodes,
    edges: workflow.edges,
  };

  for (const step of scope) {
    const node = current.nodes.find((candidate) => candidate.id === step.nodeId);
    const nodeType = nodeTypes.find((candidate) => candidate.id === node?.type);
    labels.push(`${nodeType?.name ?? node?.type ?? step.nodeId}.${formatSubflowName(step.subflowName)}`);
    const next = node?.subflows?.[step.subflowName];
    current =
      next ?? {
        nodes: [],
        edges: [],
      };
  }

  return labels.join(" / ");
}

function formatSubflowName(subflowName: string): string {
  return subflowName === "body" ? "循环体" : subflowName;
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
