import type { NodeType, RunEvent, WorkflowDocument, WorkflowNode, WorkflowSubflow } from "../types";
import type { NodeRuntimeState } from "./runState";
import { workflowNodeDisplayName } from "./nodeDisplayNames";
import { resolveNodeOutputPorts } from "./nodePorts";
import { portDisplayName } from "./schemaDisplay";
import { getEditableWorkflow, type EditScope } from "./workflow";
import { validWorkflowVariableNames } from "./workflowVariables";

export type ExpressionReferenceGroup = "node" | "project-variable" | "workflow-variable" | "variable" | "loop";

export type ExpressionReference = {
  id: string;
  group: ExpressionReferenceGroup;
  label: string;
  expression: string;
  description: string;
};

const LOOP_NODE_TYPES = new Set(["control.each_item", "control.foreach", "control.while"]);

type BuildExpressionReferencesInput = {
  workflow: WorkflowDocument;
  nodeTypes: NodeType[];
  editScope?: EditScope;
  runEvents?: RunEvent[];
  nodeRunStates?: Record<string, NodeRuntimeState>;
  projectVariables?: Record<string, unknown>;
};

export function buildExpressionReferences({
  workflow,
  nodeTypes,
  editScope,
  runEvents = [],
  nodeRunStates = {},
  projectVariables = {},
}: BuildExpressionReferencesInput): ExpressionReference[] {
  const references: ExpressionReference[] = [];
  const referenceIds = new Set<string>();
  const nodeTypeById = new Map(nodeTypes.map((nodeType) => [nodeType.id, nodeType]));
  const editableWorkflow = getEditableWorkflow(workflow, editScope);

  function addReference(reference: ExpressionReference) {
    if (referenceIds.has(reference.id)) {
      return;
    }

    references.push(reference);
    referenceIds.add(reference.id);
  }

  for (const node of editableWorkflow.nodes) {
    const nodeType = nodeTypeById.get(node.type);
    if (!nodeType) {
      continue;
    }
    const displayName = workflowNodeDisplayName(node, nodeType);

    const outputPorts = resolveNodeOutputPorts(node, nodeType);
    for (const outputName of Object.keys(outputPorts)) {
      const outputDisplayName = portDisplayName(outputName, outputPorts[outputName]);
      addReference({
        id: `node:${node.id}:${outputName}`,
        group: "node",
        label: `${displayName} · ${outputDisplayName}`,
        expression: `{{ nodes.${node.id}.outputs.${outputName} }}`,
        description: `${displayName} 的“${outputDisplayName}”输出`,
      });
    }

    for (const runtimeReference of buildRuntimeOutputReferences(node, outputPorts, displayName, nodeRunStates[node.id])) {
      addReference(runtimeReference);
    }
  }

  for (const variableName of collectVariableNames(workflow)) {
    addReference({
      id: `variable:${variableName}`,
      group: "variable",
      label: variableName,
      expression: `{{ variables.${variableName} }}`,
      description: `运行变量 ${variableName}`,
    });
  }

  for (const variableName of collectWorkflowVariableNames(workflow)) {
    addReference({
      id: `workflow-variable:${variableName}`,
      group: "workflow-variable",
      label: `vars.${variableName}`,
      expression: `{{ vars.${variableName} }}`,
      description: `工作流变量 ${variableName}`,
    });
  }

  for (const variableName of validWorkflowVariableNames(projectVariables)) {
    addReference({
      id: `project-variable:${variableName}`,
      group: "project-variable",
      label: `project.${variableName}`,
      expression: `{{ project.${variableName} }}`,
      description: `项目变量 ${variableName}`,
    });
  }

  const loopReferences = buildLoopReferences(workflow, editScope, runEvents);
  for (const reference of loopReferences) {
    addReference(reference);
  }

  return references;
}

function buildRuntimeOutputReferences(
  node: WorkflowNode,
  outputPorts: NodeType["outputs"],
  displayName: string,
  runtimeState: NodeRuntimeState | undefined
): ExpressionReference[] {
  const outputs = latestRuntimeOutputValues(runtimeState);
  if (!outputs) {
    return [];
  }

  const references: ExpressionReference[] = [];
  for (const [outputName, outputValue] of Object.entries(outputs)) {
    if (!isIdentifier(outputName)) {
      continue;
    }

    collectRuntimeOutputPaths(outputValue, [outputName]).forEach((path) => {
      const fieldPath = path.join(".");
      const [rootOutputName, ...fieldPathSegments] = path;
      const outputDisplayName = portDisplayName(rootOutputName, outputPorts[rootOutputName] ?? {});
      const fieldLabel = fieldPathSegments.join(".");
      references.push({
        id: `node:${node.id}:${fieldPath}`,
        group: "node",
        label: `${displayName} · ${outputDisplayName} · ${fieldLabel}`,
        expression: `{{ nodes.${node.id}.outputs.${fieldPath} }}`,
        description: `${displayName} 的“${outputDisplayName}”运行输出字段 ${fieldLabel}`,
      });
    });
  }

  return references;
}

function latestRuntimeOutputValues(runtimeState: NodeRuntimeState | undefined): Record<string, unknown> | null {
  const latestExecution = runtimeState?.executions?.[runtimeState.executions.length - 1];
  if (latestExecution) {
    return Object.fromEntries(
      Object.entries(latestExecution.outputs).map(([outputName, connection]) => [outputName, connection.value])
    );
  }

  return isPlainObject(runtimeState?.outputs) ? runtimeState.outputs : null;
}

function collectRuntimeOutputPaths(value: unknown, prefix: string[], depth = 0): string[][] {
  if (!isPlainObject(value) || depth >= 5) {
    return [];
  }

  const paths: string[][] = [];
  for (const [key, child] of Object.entries(value)) {
    if (!isIdentifier(key)) {
      continue;
    }

    const childPath = [...prefix, key];
    paths.push(childPath);
    paths.push(...collectRuntimeOutputPaths(child, childPath, depth + 1));
  }

  return paths.slice(0, 30);
}

function collectVariableNames(workflow: WorkflowDocument): string[] {
  const names = new Set<string>();
  collectVariableNamesFromSubflow({ nodes: workflow.nodes, edges: workflow.edges }, names);
  return [...names].sort((left, right) => left.localeCompare(right));
}

function collectWorkflowVariableNames(workflow: WorkflowDocument): string[] {
  return validWorkflowVariableNames(workflow.settings?.variables ?? {});
}

function collectVariableNamesFromSubflow(subflow: WorkflowSubflow, names: Set<string>) {
  for (const node of subflow.nodes) {
    if (node.type === "logic.set_variable" && typeof node.config.name === "string" && isIdentifier(node.config.name)) {
      names.add(node.config.name);
    }

    for (const child of Object.values(node.subflows ?? {})) {
      collectVariableNamesFromSubflow(child, names);
    }
  }
}

function buildLoopReferences(
  workflow: WorkflowDocument,
  editScope: EditScope,
  runEvents: RunEvent[]
): ExpressionReference[] {
  const parent = nearestLoopParent(workflow, editScope);
  if (!parent) {
    return [];
  }

  const references: ExpressionReference[] = [
    {
      id: "loop:item",
      group: "loop",
      label: "loop.item",
      expression: "{{ loop.item }}",
      description: "当前循环项",
    },
  ];

  for (const columnName of csvColumnsForLoopParent(parent, runEvents)) {
    references.push({
      id: `loop:item:${columnName}`,
      group: "loop",
      label: `loop.item.${columnName}`,
      expression: `{{ loop.item.${columnName} }}`,
      description: `当前 CSV 行的 ${columnName} 列`,
    });
  }

  return references;
}

function nearestLoopParent(
  workflow: WorkflowDocument,
  editScope: EditScope
): { node: WorkflowNode; parentSubflow: WorkflowSubflow } | null {
  if (!editScope?.length) {
    return null;
  }

  let current: WorkflowSubflow = { nodes: workflow.nodes, edges: workflow.edges };
  for (const step of editScope) {
    const node = current.nodes.find((candidate) => candidate.id === step.nodeId);
    if (!node) {
      return null;
    }

    if (LOOP_NODE_TYPES.has(node.type) && step.subflowName === "body") {
      return { node, parentSubflow: current };
    }

    current = node.subflows?.[step.subflowName] ?? { nodes: [], edges: [] };
  }

  return null;
}

function csvColumnsForLoopParent(
  parent: { node: WorkflowNode; parentSubflow: WorkflowSubflow },
  runEvents: RunEvent[]
): string[] {
  const csvNodeId = csvNodeIdForLoopParent(parent);
  if (!csvNodeId) {
    return [];
  }

  const csvNode = parent.parentSubflow.nodes.find((node) => node.id === csvNodeId && node.type === "data.csv_read");
  if (!csvNode) {
    return [];
  }

  return csvColumnsFromRunEvents(csvNode.id, runEvents);
}

function csvNodeIdForLoopParent(parent: { node: WorkflowNode; parentSubflow: WorkflowSubflow }): string | null {
  if (parent.node.type === "control.foreach") {
    return csvNodeIdFromItemsExpression(parent.node.config.items_expression);
  }

  if (parent.node.type !== "control.each_item") {
    return null;
  }

  const edge = parent.parentSubflow.edges.find(
    (candidate) =>
      candidate.target === parent.node.id &&
      candidate.targetHandle === "items" &&
      candidate.sourceHandle === "items"
  );
  const source = edge && parent.parentSubflow.nodes.find((node) => node.id === edge.source);
  return source?.type === "data.csv_read" ? source.id : null;
}

function csvNodeIdFromItemsExpression(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/^\s*\{\{\s*nodes\.([A-Za-z_][A-Za-z0-9_]*)\.outputs\.success\.rows\s*\}\}\s*$/);
  return match?.[1] ?? null;
}

function csvColumnsFromRunEvents(nodeId: string, runEvents: RunEvent[]): string[] {
  for (const event of [...runEvents].reverse()) {
    if (event.node_id !== nodeId || event.type !== "node_succeeded") {
      continue;
    }

    const outputs = event.payload.outputs;
    if (!isPlainObject(outputs) || !isPlainObject(outputs.success)) {
      continue;
    }

    const { headers, columns } = outputs.success;
    if (Array.isArray(headers)) {
      return headers.map(String).filter(isIdentifier);
    }
    if (isPlainObject(columns)) {
      return Object.keys(columns).filter(isIdentifier);
    }
  }

  return [];
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
