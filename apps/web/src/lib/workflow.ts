import type {
  CanvasAnnotation,
  CanvasAnnotationColor,
  JsonSchema,
  NodeType,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
  WorkflowSubflow,
} from "../types";
import { effectiveSchema, schemaFieldTypes } from "./jsonSchema";

import { isWorkflowConcurrentRunsInRange } from "./workflowSettings";
type NodePosition = WorkflowNode["position"];
export type EditScopeStep = { nodeId: string; subflowName: string };
export type EditScope = EditScopeStep[] | undefined;

const LOOP_NODE_TYPES = new Set(["control.each_item", "control.foreach", "control.while"]);
export const DEFAULT_WORKFLOW_TIMEOUT_SECONDS = 600;

export function createEmptyWorkflow(): WorkflowDocument {
  return {
    id: prefixedId("wf"),
    name: "未命名工作流",
    active: false,
    description: "",
    tags: [],
    version: 1,
    nodes: [],
    edges: [],
    annotations: [],
    settings: {
      timeout_seconds: DEFAULT_WORKFLOW_TIMEOUT_SECONDS,
      variables: {},
      error_workflow_id: null,
      max_concurrent_runs: null,
      environment_id: "default",
    },
  };
}

export function duplicateWorkflowDraft(workflow: WorkflowDocument): WorkflowDocument {
  const draftId = prefixedId("wf");
  const cloned = cloneWorkflowDocument(normalizeWorkflowDocument(workflow));

  return {
    ...cloned,
    id: draftId,
    name: `${workflow.name.trim() || "未命名工作流"} 副本`,
    active: false,
    version: 1,
  };
}

export function normalizeWorkflowDocument(workflow: WorkflowDocument): WorkflowDocument {
  const root = normalizeWorkflowSubflow(workflow);

  return {
    ...workflow,
    active: typeof workflow.active === "boolean" ? workflow.active : true,
    description: typeof workflow.description === "string" ? workflow.description.trim() : "",
    tags: normalizeWorkflowTags(workflow.tags),
    nodes: root.nodes,
    edges: root.edges,
    annotations: root.annotations,
    settings: {
      ...workflow.settings,
      timeout_seconds: workflowTimeoutSeconds(workflow),
      variables: workflowVariables(workflow),
      error_workflow_id: workflow.settings?.error_workflow_id?.trim() || null,
      max_concurrent_runs: workflowMaxConcurrentRuns(workflow),
      environment_id: workflowEnvironmentId(workflow),
    },
  };
}

function normalizeWorkflowTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  const seen = new Set<string>();
  return tags.flatMap((rawTag) => {
    if (typeof rawTag !== "string") {
      return [];
    }
    const tag = rawTag.trim();
    const normalizedTag = tag.toLocaleLowerCase();
    if (!tag || seen.has(normalizedTag)) {
      return [];
    }
    seen.add(normalizedTag);
    return [tag];
  });
}

function normalizeWorkflowSubflow(subflow: Partial<WorkflowSubflow>): WorkflowSubflow {
  return {
    nodes: Array.isArray(subflow.nodes) ? subflow.nodes.map(normalizeWorkflowNode) : [],
    edges: Array.isArray(subflow.edges) ? subflow.edges : [],
    annotations: normalizeCanvasAnnotations(subflow.annotations),
  };
}

function normalizeCanvasAnnotations(value: unknown): CanvasAnnotation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((rawAnnotation) => {
    if (!isRecord(rawAnnotation) || typeof rawAnnotation.id !== "string" || !rawAnnotation.id.trim()) {
      return [];
    }

    return [
      {
        id: rawAnnotation.id,
        content: typeof rawAnnotation.content === "string" ? rawAnnotation.content.trim().slice(0, 5000) : "",
        position: normalizeNodePosition(rawAnnotation.position),
        width: annotationDimension(rawAnnotation.width, 320, 160, 1600),
        height: annotationDimension(rawAnnotation.height, 180, 100, 1200),
        color: normalizeAnnotationColor(rawAnnotation.color),
      },
    ];
  });
}

function annotationDimension(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const normalized = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, normalized));
}

function normalizeAnnotationColor(value: unknown): CanvasAnnotationColor {
  return value === "blue" || value === "green" || value === "pink" || value === "yellow" ? value : "yellow";
}

function normalizeWorkflowNode(node: WorkflowNode): WorkflowNode {
  const normalizedSubflows = normalizeWorkflowNodeSubflows(node);
  const label = typeof node.label === "string" ? node.label.trim().slice(0, 120) : "";
  const notes = typeof node.notes === "string" ? node.notes.trim().slice(0, 2000) : "";

  return {
    ...node,
    ...(label ? { label } : {}),
    ...(notes ? { notes } : {}),
    typeVersion: normalizeNodeTypeVersion(node.typeVersion),
    position: normalizeNodePosition(node.position),
    config: isRecord(node.config) ? node.config : {},
    ...(isRecord(node.pinnedData) ? { pinnedData: node.pinnedData } : {}),
    ...(normalizedSubflows ? { subflows: normalizedSubflows } : {}),
  };
}

function normalizeNodeTypeVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeNodePosition(position: unknown): NodePosition {
  if (!isRecord(position)) {
    return { x: 0, y: 0 };
  }

  return {
    x: finiteNumber(position.x),
    y: finiteNumber(position.y),
  };
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeWorkflowNodeSubflows(node: WorkflowNode): Record<string, WorkflowSubflow> | undefined {
  const subflows = isRecord(node.subflows) ? node.subflows : {};
  const normalized = Object.fromEntries(
    Object.entries(subflows).map(([name, subflow]) => [name, normalizeWorkflowSubflow(subflow as Partial<WorkflowSubflow>)])
  );

  if (LOOP_NODE_TYPES.has(node.type) && !normalized.body) {
    normalized.body = {
      nodes: [],
      edges: [],
      annotations: [],
    };
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function workflowTimeoutSeconds(workflow: WorkflowDocument): number {
  return workflow.settings?.timeout_seconds ?? DEFAULT_WORKFLOW_TIMEOUT_SECONDS;
}

export function workflowMaxConcurrentRuns(workflow: WorkflowDocument): number | null {
  const maxConcurrentRuns = workflow.settings?.max_concurrent_runs;
  return typeof maxConcurrentRuns === "number" && isWorkflowConcurrentRunsInRange(maxConcurrentRuns)
    ? maxConcurrentRuns
    : null;
}

export function workflowVariables(workflow: WorkflowDocument): Record<string, unknown> {
  return workflow.settings?.variables ?? {};
}

export function workflowErrorWorkflowId(workflow: WorkflowDocument): string | null {
  return workflow.settings?.error_workflow_id?.trim() || null;
}

export function workflowEnvironmentId(workflow: WorkflowDocument): string {
  return workflow.settings?.environment_id?.trim() || "default";
}

export function createWorkflowNode(nodeType: NodeType, position: NodePosition): WorkflowNode {
  const config = defaultsFromSchema(nodeType.configSchema);
  const dynamicInputs = nodeType.dynamicInputs;
  const dynamicOutputs = nodeType.dynamicOutputs;
  const dynamicInputConfigValue = dynamicInputs ? config[dynamicInputs.configKey] : undefined;
  const dynamicConfigValue = dynamicOutputs ? config[dynamicOutputs.configKey] : undefined;
  if (
    dynamicInputs?.defaultItems?.length &&
    (!Array.isArray(dynamicInputConfigValue) || dynamicInputConfigValue.length === 0)
  ) {
    config[dynamicInputs.configKey] = cloneWorkflowValue(dynamicInputs.defaultItems);
  }
  if (
    dynamicOutputs?.defaultItems?.length &&
    (!Array.isArray(dynamicConfigValue) || dynamicConfigValue.length === 0)
  ) {
    config[dynamicOutputs.configKey] = cloneWorkflowValue(dynamicOutputs.defaultItems);
  }

  const node: WorkflowNode = {
    id: prefixedId("node"),
    type: nodeType.id,
    typeVersion: normalizeNodeTypeVersion(nodeType.version),
    position,
    config,
  };

  if (LOOP_NODE_TYPES.has(nodeType.id)) {
    node.subflows = {
      body: {
        nodes: [],
        edges: [],
        annotations: [],
      },
    };
  }

  return node;
}

export function nextWorkflowNodePosition(nodeCount: number): NodePosition {
  const columnCount = 3;
  const index = Math.max(0, Math.floor(nodeCount));

  return {
    x: 80 + (index % columnCount) * 260,
    y: 80 + Math.floor(index / columnCount) * 200,
  };
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

export function createCanvasAnnotation(position: CanvasAnnotation["position"]): CanvasAnnotation {
  return {
    id: prefixedId("annotation"),
    content: "",
    position,
    width: 320,
    height: 180,
    color: "yellow",
  };
}

export function duplicateWorkflowNode(
  node: WorkflowNode,
  offset: { x: number; y: number } = { x: 0, y: 200 }
): WorkflowNode {
  return cloneWorkflowNodeWithFreshIds(node, offset);
}

export function duplicateWorkflowNodes(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  selectedNodeIds: Iterable<string>,
  offset: { x: number; y: number } = { x: 0, y: 200 }
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const selectedIds = new Set(selectedNodeIds);
  const nodeIdMap = new Map<string, string>();
  const duplicatedNodes = nodes.flatMap((node) => {
    if (!selectedIds.has(node.id)) {
      return [];
    }

    const duplicate = duplicateWorkflowNode(node, offset);
    nodeIdMap.set(node.id, duplicate.id);
    return [duplicate];
  });

  const duplicatedEdges = edges.flatMap((edge) => {
    const source = nodeIdMap.get(edge.source);
    const target = nodeIdMap.get(edge.target);
    if (!source || !target) {
      return [];
    }

    return [
      {
        ...edge,
        id: prefixedId("edge"),
        source,
        target,
      },
    ];
  });

  return { nodes: duplicatedNodes, edges: duplicatedEdges };
}

function cloneWorkflowNodeWithFreshIds(node: WorkflowNode, offset: { x: number; y: number }): WorkflowNode {
  return {
    ...node,
    id: prefixedId("node"),
    position: {
      x: node.position.x + offset.x,
      y: node.position.y + offset.y,
    },
    config: cloneWorkflowValue(node.config),
    ...(node.pinnedData ? { pinnedData: cloneWorkflowValue(node.pinnedData) } : {}),
    ...(node.execution ? { execution: cloneWorkflowValue(node.execution) } : {}),
    ...(node.subflows ? { subflows: cloneWorkflowSubflowsWithFreshIds(node.subflows) } : {}),
  };
}

function cloneWorkflowSubflowsWithFreshIds(subflows: Record<string, WorkflowSubflow>): Record<string, WorkflowSubflow> {
  return Object.fromEntries(
    Object.entries(subflows).map(([name, subflow]) => [name, cloneWorkflowSubflowWithFreshIds(subflow)])
  );
}

function cloneWorkflowSubflowWithFreshIds(subflow: WorkflowSubflow): WorkflowSubflow {
  const nodeIdMap = new Map<string, string>();
  const nodes = subflow.nodes.map((node) => {
    const duplicate = cloneWorkflowNodeWithFreshIds(node, { x: 0, y: 0 });
    nodeIdMap.set(node.id, duplicate.id);
    return duplicate;
  });

  return {
    nodes,
    edges: subflow.edges.map((edge) => ({
      ...edge,
      id: prefixedId("edge"),
      source: nodeIdMap.get(edge.source) ?? edge.source,
      target: nodeIdMap.get(edge.target) ?? edge.target,
    })),
    annotations: (subflow.annotations ?? []).map((annotation) => ({
      ...annotation,
      id: prefixedId("annotation"),
    })),
  };
}

function cloneWorkflowValue<Value>(value: Value): Value {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as Value;
}

export function getEditableWorkflow(workflow: WorkflowDocument, scope: EditScope): WorkflowSubflow {
  let current: WorkflowSubflow = {
    nodes: workflow.nodes,
    edges: workflow.edges,
    annotations: workflow.annotations ?? [],
  };

  for (const step of scope ?? []) {
    const next = current.nodes.find((node) => node.id === step.nodeId)?.subflows?.[step.subflowName];
    if (!next) {
      return {
        nodes: [],
        edges: [],
        annotations: [],
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
      annotations: next.annotations ?? [],
    };
  }

  const [updatedRoot, didUpdate] = updateSubflowAtPath(
    {
      nodes: workflow.nodes,
      edges: workflow.edges,
      annotations: workflow.annotations ?? [],
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
            annotations: [],
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
      ...current,
      nodes: updatedNodes,
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
    Object.entries(schema.properties).map(([key, propertySchema]) => [key, defaultForSchema(propertySchema, schema)])
  );
}

function defaultForSchema(schema: JsonSchema, rootSchema: JsonSchema = schema): unknown {
  const activeSchema = effectiveSchema(schema, rootSchema);

  if ("default" in activeSchema) {
    return activeSchema.default;
  }

  if (activeSchema.enum?.length) {
    return activeSchema.enum[0];
  }

  const schemaType = schemaFieldTypes(activeSchema, rootSchema)[0];

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
function cloneWorkflowDocument(workflow: WorkflowDocument): WorkflowDocument {
  if (typeof structuredClone === "function") {
    return structuredClone(workflow);
  }

  return JSON.parse(JSON.stringify(workflow)) as WorkflowDocument;
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
