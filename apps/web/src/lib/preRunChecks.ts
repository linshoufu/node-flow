import { validateConnection } from "./connectionValidation";
import { dynamicPortConfigurationIssues, resolveNodeInputPorts } from "./nodePorts";
import { effectiveSchema } from "./jsonSchema";
import { isEmptySchemaFieldValue, validateSchemaField } from "./schemaFieldValidation";
import type { JsonSchema, NodeType, WorkflowDocument, WorkflowEdge, WorkflowNode, WorkflowSubflow } from "../types";
import {
  isWorkflowConcurrentRunsInRange,
  isWorkflowTimeoutSecondsInRange,
  WORKFLOW_CONCURRENT_RUNS_RANGE_MESSAGE,
  WORKFLOW_TIMEOUT_RANGE_MESSAGE,
} from "./workflowSettings";
import { WORKFLOW_VARIABLE_NAME_ERROR, buildWorkflowVariableIssues } from "./workflowVariables";

export type PreRunIssueSeverity = "error" | "warning";

export type NodePreRunIssue = {
  id: string;
  nodeId: string;
  nodeType: string;
  severity: PreRunIssueSeverity;
  title: string;
  message: string;
  field?: string;
  path?: string[];
};

export type SettingsPreRunIssue = {
  id: string;
  severity: PreRunIssueSeverity;
  title: string;
  message: string;
  field?: string;
  path?: string[];
  targetKind: "settings";
};

export type EdgePreRunIssue = {
  id: string;
  edgeId: string;
  severity: PreRunIssueSeverity;
  title: string;
  message: string;
  field?: string;
  path?: string[];
  targetKind: "edge";
};

export type PreRunIssue = NodePreRunIssue | SettingsPreRunIssue | EdgePreRunIssue;

export function buildPreRunIssues(workflow: WorkflowDocument, nodeTypes?: NodeType[]): PreRunIssue[] {
  const loadedNodeTypes = nodeTypes ?? [];
  const nodeTypesById = new Map(loadedNodeTypes.map((nodeType) => [nodeType.id, nodeType]));
  return [
    ...collectSettingsIssues(workflow),
    ...collectWorkflowIssues(workflow.nodes, workflow.edges, ["root"], loadedNodeTypes, nodeTypesById, nodeTypes !== undefined),
  ];
}

export function isNodePreRunIssue(issue: PreRunIssue): issue is NodePreRunIssue {
  return !("targetKind" in issue);
}

export function isSettingsPreRunIssue(issue: PreRunIssue): issue is SettingsPreRunIssue {
  return "targetKind" in issue && issue.targetKind === "settings";
}

function collectSettingsIssues(workflow: WorkflowDocument): PreRunIssue[] {
  const issues: PreRunIssue[] = [];
  const timeoutSeconds = workflow.settings?.timeout_seconds;
  if (timeoutSeconds !== undefined && !isWorkflowTimeoutSecondsInRange(timeoutSeconds)) {
    issues.push({
      id: "root:settings:timeout_seconds",
      severity: "error",
      title: "\u5de5\u4f5c\u6d41\u8bbe\u7f6e\u4e0d\u5408\u6cd5",
      message: WORKFLOW_TIMEOUT_RANGE_MESSAGE,
      field: "timeout_seconds",
      path: ["root", "settings"],
      targetKind: "settings",
    });
  }

  const maxConcurrentRuns = workflow.settings?.max_concurrent_runs;
  if (maxConcurrentRuns !== undefined && maxConcurrentRuns !== null && !isWorkflowConcurrentRunsInRange(maxConcurrentRuns)) {
    issues.push({
      id: "root:settings:max_concurrent_runs",
      severity: "error",
      title: "\u5de5\u4f5c\u6d41\u8bbe\u7f6e\u4e0d\u5408\u6cd5",
      message: WORKFLOW_CONCURRENT_RUNS_RANGE_MESSAGE,
      field: "max_concurrent_runs",
      path: ["root", "settings"],
      targetKind: "settings",
    });
  }

  for (const variableIssue of buildWorkflowVariableIssues(workflow.settings?.variables ?? {})) {
    issues.push({
      id: `root:settings:variables:${variableIssue.name}`,
      severity: "error",
      title: "\u5de5\u4f5c\u6d41\u53d8\u91cf\u540d\u4e0d\u5408\u6cd5",
      message: `\u53d8\u91cf ${variableIssue.name}\uff1a${WORKFLOW_VARIABLE_NAME_ERROR}`,
      field: variableIssue.name,
      path: ["root", "settings"],
      targetKind: "settings",
    });
  }

  return issues;
}
function collectWorkflowIssues(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  parentPath: string[],
  nodeTypes: NodeType[],
  nodeTypesById: Map<string, NodeType>,
  reportUnknownNodeTypes: boolean
): PreRunIssue[] {
  const nodeIssues = collectNodeIssues(nodes, parentPath, nodeTypes, nodeTypesById, reportUnknownNodeTypes);
  const edgeIssues = collectEdgeIssues(nodes, edges, parentPath, nodeTypes, nodeTypesById);
  const inputIssues = collectRequiredInputIssues(nodes, edges, parentPath, nodeTypes, nodeTypesById);
  return [...nodeIssues, ...edgeIssues, ...inputIssues];
}

function collectNodeIssues(
  nodes: WorkflowNode[],
  parentPath: string[],
  nodeTypes: NodeType[],
  nodeTypesById: Map<string, NodeType>,
  reportUnknownNodeTypes: boolean
): PreRunIssue[] {
  return nodes.flatMap((node) => {
    if (node.disabled) {
      return [];
    }
    const nodePath = [...parentPath, node.id];
    return [
      ...issuesForNode(node, nodePath, nodeTypesById.get(node.type), reportUnknownNodeTypes),
      ...subflowIssues(node, nodePath, nodeTypes, nodeTypesById, reportUnknownNodeTypes),
    ];
  });
}

function subflowIssues(
  node: WorkflowNode,
  nodePath: string[],
  nodeTypes: NodeType[],
  nodeTypesById: Map<string, NodeType>,
  reportUnknownNodeTypes: boolean
): PreRunIssue[] {
  if (!node.subflows) {
    return [];
  }

  return Object.entries(node.subflows).flatMap(([subflowName, subflow]) =>
    collectSubflowIssues(subflowName, subflow, nodePath, nodeTypes, nodeTypesById, reportUnknownNodeTypes)
  );
}

function collectSubflowIssues(
  subflowName: string,
  subflow: WorkflowSubflow,
  nodePath: string[],
  nodeTypes: NodeType[],
  nodeTypesById: Map<string, NodeType>,
  reportUnknownNodeTypes: boolean
): PreRunIssue[] {
  return collectWorkflowIssues(
    subflow.nodes,
    subflow.edges,
    [...nodePath, subflowName],
    nodeTypes,
    nodeTypesById,
    reportUnknownNodeTypes
  );
}

function collectEdgeIssues(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  parentPath: string[],
  nodeTypes: NodeType[],
  nodeTypesById: Map<string, NodeType>
): PreRunIssue[] {
  const workflowForEdgeValidation: WorkflowDocument = {
    id: parentPath.join("/"),
    name: parentPath.join(" / "),
    version: 1,
    nodes,
    edges,
  };

  const issues: PreRunIssue[] = [];
  const previousEdges: WorkflowEdge[] = [];

  for (const edge of edges) {
    const scopedWorkflow = {
      ...workflowForEdgeValidation,
      edges: previousEdges,
    };
    const result = validateConnection(edge, scopedWorkflow, nodeTypes);

    if (!result.valid) {
      issues.push({
        id: `${parentPath.join("/")}:edge:${edge.id}`,
        edgeId: edge.id,
        severity: "error" as const,
        title: result.message.includes("\u6570\u636e\u7c7b\u578b") ? "\u8fde\u7ebf\u7c7b\u578b\u4e0d\u5339\u914d" : "\u8fde\u7ebf\u65e0\u6548",
        message: edgeIssueMessage(edge, result.message),
        field: edge.targetHandle,
        path: parentPath,
        targetKind: "edge" as const,
      });
    }

    previousEdges.push(edge);
  }

  return issues;
}

function edgeIssueMessage(edge: WorkflowEdge, message: string): string {
  if (!message.includes("输出端口 ") || !message.includes("输入端口 ")) {
    return message;
  }

  return message
    .replace(`输出端口 ${edge.sourceHandle}`, `输出端口 ${edge.source}.${edge.sourceHandle}`)
    .replace(`输入端口 ${edge.targetHandle}`, `输入端口 ${edge.target}.${edge.targetHandle}`);
}

function collectRequiredInputIssues(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  parentPath: string[],
  nodeTypes: NodeType[],
  nodeTypesById: Map<string, NodeType>
): PreRunIssue[] {
  const connectedInputs = validConnectedInputHandles(nodes, edges, parentPath, nodeTypes);

  return nodes.flatMap((node) => {
    if (node.disabled) {
      return [];
    }
    const nodeType = nodeTypesById.get(node.type);
    if (!nodeType) {
      return [];
    }

    return Object.entries(resolveNodeInputPorts(node, nodeType)).flatMap(([inputName, inputPort]) => {
      if (inputPort.required === false || connectedInputs.has(`${node.id}:${inputName}`)) {
        return [];
      }

      return [
        {
          id: `${[...parentPath, node.id].join("/")}:${inputName}`,
          nodeId: node.id,
          nodeType: node.type,
          severity: "error" as const,
          title: "\u8282\u70b9\u8f93\u5165\u4e0d\u5b8c\u6574",
          message: `\u7f3a\u5c11\u5fc5\u586b\u8f93\u5165\u7aef\u53e3\uff1a${inputName}\u3002`,
          field: inputName,
          path: [...parentPath, node.id],
        },
      ];
    });
  });
}

function validConnectedInputHandles(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  parentPath: string[],
  nodeTypes: NodeType[]
): Set<string> {
  const connectedInputs = new Set<string>();
  const workflowForEdgeValidation: WorkflowDocument = {
    id: parentPath.join("/"),
    name: parentPath.join(" / "),
    version: 1,
    nodes,
    edges,
  };
  const previousEdges: WorkflowEdge[] = [];

  for (const edge of edges) {
    const result = validateConnection(edge, { ...workflowForEdgeValidation, edges: previousEdges }, nodeTypes);
    if (result.valid) {
      connectedInputs.add(`${edge.target}:${edge.targetHandle}`);
    }
    previousEdges.push(edge);
  }

  return connectedInputs;
}
function issuesForNode(
  node: WorkflowNode,
  path: string[],
  nodeType: NodeType | undefined,
  reportUnknownNodeTypes: boolean
): PreRunIssue[] {
  if (!nodeType) {
    if (!reportUnknownNodeTypes) {
      return specificIssuesForNode(node, path);
    }

    return [
      issue(
        node,
        path,
        "type",
        "\u8282\u70b9\u7c7b\u578b\u672a\u52a0\u8f7d",
        `\u8282\u70b9\u7c7b\u578b ${node.type} \u5f53\u524d\u4e0d\u53ef\u7528\uff0c\u8bf7\u5237\u65b0\u8282\u70b9\u5e93\u6216\u6062\u590d\u5bf9\u5e94 Python \u8282\u70b9\u811a\u672c\u3002`
      ),
    ];
  }

  const specificIssues = specificIssuesForNode(node, path);
  const specificIssueFields = new Set(specificIssues.map((issue) => issue.field));
  const schemaIssues = schemaFieldIssues(node, path, nodeType.configSchema).filter(
    (issue) => !specificIssueFields.has(issue.field)
  );
  const schemaIssueFields = new Set(schemaIssues.map((issue) => issue.field));
  const dynamicPortIssues = dynamicPortConfigurationIssues(node, nodeType)
    .filter((dynamicIssue) => !schemaIssueFields.has(dynamicIssue.field))
    .map((dynamicIssue) =>
      issue(node, path, dynamicIssue.field, "动态端口配置不合法", dynamicIssue.message)
    );
  return [...specificIssues, ...schemaIssues, ...dynamicPortIssues];
}

function specificIssuesForNode(node: WorkflowNode, path: string[]): PreRunIssue[] {
  switch (node.type) {
    case "http.request":
      return [
        requiredFieldIssue(node, path, "method", "HTTP \u8bf7\u6c42\u914d\u7f6e\u4e0d\u5b8c\u6574", "HTTP \u8bf7\u6c42\u7f3a\u5c11\u8bf7\u6c42\u65b9\u6cd5\u3002"),
        requiredFieldIssue(node, path, "url", "HTTP \u8bf7\u6c42\u914d\u7f6e\u4e0d\u5b8c\u6574", "HTTP \u8bf7\u6c42\u7f3a\u5c11 URL\u3002"),
      ].filter(isIssue);
    case "data.csv_read":
      return [requiredFieldIssue(node, path, "path", "CSV \u8bfb\u53d6\u914d\u7f6e\u4e0d\u5b8c\u6574", "\u8bfb\u53d6 CSV \u7f3a\u5c11\u6587\u4ef6\u8def\u5f84\u3002")].filter(
        isIssue
      );
    case "assert.status_code":
      return statusCodeAssertionIssues(node, path);
    case "test.write_report":
      return [
        requiredFieldIssue(node, path, "path", "\u6d4b\u8bd5\u62a5\u544a\u914d\u7f6e\u4e0d\u5b8c\u6574", "\u5199\u5165\u6d4b\u8bd5\u62a5\u544a\u7f3a\u5c11\u8f93\u51fa\u8def\u5f84\u3002"),
      ].filter(isIssue);
    case "control.foreach":
      return [
        requiredFieldIssue(
          node,
          path,
          "items_expression",
          "\u904d\u5386\u5faa\u73af\u914d\u7f6e\u4e0d\u5b8c\u6574",
          "\u904d\u5386\u5faa\u73af\u7f3a\u5c11\u5faa\u73af\u6570\u636e\u6765\u6e90\u3002"
        ),
      ].filter(isIssue);
    default:
      return [];
  }
}

function schemaFieldIssues(node: WorkflowNode, path: string[], schema: JsonSchema | undefined): PreRunIssue[] {
  if (!schema) {
    return [];
  }

  const staleConfigIssues = staleConfigKeyIssues(node, path, schema);
  const requiredFields = new Set(schema.required ?? []);
  const fields = new Set([...Object.keys(schema.properties ?? {}), ...requiredFields]);

  const declaredFieldIssues = Array.from(fields).flatMap((field) => {
    const fieldSchema = schema.properties?.[field] ?? {};
    const value = node.config[field];
    const fieldErrors = validateSchemaField({
      value,
      schema: fieldSchema,
      rootSchema: schema,
      isRequired: requiredFields.has(field),
    });

    if (!fieldErrors.length) {
      return [];
    }

    const label = fieldLabel(field, fieldSchema, schema);
    const isMissingRequired = requiredFields.has(field) && isEmptySchemaFieldValue(value);
    const title = isMissingRequired ? "\u8282\u70b9\u914d\u7f6e\u4e0d\u5b8c\u6574" : "\u8282\u70b9\u914d\u7f6e\u4e0d\u5408\u6cd5";
    const message = isMissingRequired ? `\u7f3a\u5c11\u5fc5\u586b\u914d\u7f6e\uff1a${label}\u3002` : `${label}\uff1a${fieldErrors.join("\uff1b")}\u3002`;

    return [issue(node, path, field, title, message)];
  });

  return [...declaredFieldIssues, ...staleConfigIssues];
}

function fieldLabel(field: string, schema: JsonSchema, rootSchema: JsonSchema): string {
  const activeSchema = effectiveSchema(schema, rootSchema);
  return typeof activeSchema.title === "string" && activeSchema.title.trim() ? activeSchema.title : field;
}

function staleConfigKeyIssues(node: WorkflowNode, path: string[], schema: JsonSchema): PreRunIssue[] {
  if (schema.additionalProperties !== false) {
    return [];
  }

  const declaredFields = new Set(Object.keys(schema.properties ?? {}));
  return Object.keys(node.config)
    .filter((field) => !declaredFields.has(field))
    .map((field) =>
      issue(
        node,
        path,
        field,
        "\u8282\u70b9\u914d\u7f6e\u5305\u542b\u5df2\u79fb\u9664\u5b57\u6bb5",
        `\u914d\u7f6e\u5b57\u6bb5 ${field} \u5f53\u524d\u4e0d\u5728\u8282\u70b9\u5b9a\u4e49\u4e2d\uff0c\u53ef\u80fd\u6765\u81ea\u65e7\u7248 Python \u8282\u70b9\u811a\u672c\uff0c\u8bf7\u5220\u9664\u6216\u8fc1\u79fb\u3002`
      )
    );
}
function statusCodeAssertionIssues(node: WorkflowNode, path: string[]): PreRunIssue[] {
  if (!hasConfigField(node, "expected") || !isExplicitEmptyConfigValue(node.config.expected)) {
    return [];
  }

  return [
    issue(node, path, "expected", "\u72b6\u6001\u7801\u65ad\u8a00\u914d\u7f6e\u4e0d\u5b8c\u6574", "\u72b6\u6001\u7801\u65ad\u8a00\u7f3a\u5c11\u671f\u671b\u72b6\u6001\u7801\u3002"),
  ];
}

function requiredFieldIssue(
  node: WorkflowNode,
  path: string[],
  field: string,
  title: string,
  message: string
): PreRunIssue | undefined {
  if (!isEmptyConfigValue(node.config[field])) {
    return undefined;
  }

  return issue(node, path, field, title, message);
}

function issue(node: WorkflowNode, path: string[], field: string, title: string, message: string): PreRunIssue {
  return {
    id: `${path.join("/")}:${field}`,
    nodeId: node.id,
    nodeType: node.type,
    severity: "error",
    title,
    message,
    field,
    path,
  };
}

function isEmptyConfigValue(value: unknown): value is null | undefined | string {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function isExplicitEmptyConfigValue(value: unknown): value is null | string {
  return value === null || (typeof value === "string" && value.trim() === "");
}

function hasConfigField(node: WorkflowNode, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(node.config, field);
}

function isIssue(issue: PreRunIssue | undefined): issue is PreRunIssue {
  return issue !== undefined;
}
