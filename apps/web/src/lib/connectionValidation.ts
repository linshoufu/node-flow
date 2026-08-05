import type { JsonSchema, NodeType, WorkflowDocument } from "../types";
import { schemaFieldTypes } from "./jsonSchema";
import { resolveNodeInputPorts, resolveNodeOutputPorts } from "./nodePorts";
import { portDisplayName } from "./schemaDisplay";

export type ConnectionCandidate = {
  source?: string | null;
  sourceHandle?: string | null;
  target?: string | null;
  targetHandle?: string | null;
};

export type ConnectionValidationCode =
  | "incomplete_endpoint"
  | "self_connection"
  | "unknown_source_node"
  | "unknown_target_node"
  | "unknown_source_type"
  | "unknown_target_type"
  | "unknown_source_port"
  | "unknown_target_port"
  | "duplicate_connection"
  | "input_already_connected"
  | "output_connection_limit_reached"
  | "incompatible_connection_kind"
  | "output_port_filter_rejected"
  | "input_port_filter_rejected"
  | "incompatible_schema";

export type ConnectionValidationResult =
  | {
      valid: true;
    }
  | {
      valid: false;
      code: ConnectionValidationCode;
      message: string;
      sourcePort?: string;
      targetPort?: string;
      sourceSchemaLabel?: string;
      targetSchemaLabel?: string;
      sourceConnectionKind?: string;
      targetConnectionKind?: string;
    };

export function validateConnection(
  connection: ConnectionCandidate,
  workflow: WorkflowDocument,
  nodeTypes: NodeType[]
): ConnectionValidationResult {
  const { source, sourceHandle, target, targetHandle } = connection;

  if (!source || !sourceHandle || !target || !targetHandle) {
    return invalid("incomplete_endpoint", "请从输出端口拖到输入端口。");
  }

  if (source === target) {
    return invalid("self_connection", "不能把节点连接到自己。");
  }

  const sourceNode = workflow.nodes.find((node) => node.id === source);
  const targetNode = workflow.nodes.find((node) => node.id === target);
  if (!sourceNode) {
    return invalid("unknown_source_node", "源节点不存在。");
  }
  if (!targetNode) {
    return invalid("unknown_target_node", "目标节点不存在。");
  }

  const nodeTypeById = new Map(nodeTypes.map((nodeType) => [nodeType.id, nodeType]));
  const sourceType = nodeTypeById.get(sourceNode.type);
  const targetType = nodeTypeById.get(targetNode.type);
  if (!sourceType) {
    return invalid("unknown_source_type", "源节点类型未加载，不能连接。");
  }
  if (!targetType) {
    return invalid("unknown_target_type", "目标节点类型未加载，不能连接。");
  }

  const sourcePort = resolveNodeOutputPorts(sourceNode, sourceType)[sourceHandle];
  const targetPort = resolveNodeInputPorts(targetNode, targetType)[targetHandle];

  if (!sourcePort) {
    return invalid("unknown_source_port", `源节点没有输出端口 ${sourceHandle}。`);
  }
  if (!targetPort) {
    return invalid("unknown_target_port", `目标节点没有输入端口 ${targetHandle}。`);
  }

  if (!portAllowsNodeType(sourcePort, targetType.id)) {
    return {
      valid: false,
      code: "output_port_filter_rejected",
      message: `输出端口 ${portDisplayName(sourceHandle, sourcePort)} 不允许连接到节点类型 ${nodeTypeDisplayName(targetType)}。`,
      sourcePort: sourceHandle,
      targetPort: targetHandle,
    };
  }
  if (!portAllowsNodeType(targetPort, sourceType.id)) {
    return {
      valid: false,
      code: "input_port_filter_rejected",
      message: `输入端口 ${portDisplayName(targetHandle, targetPort)} 不接受来自节点类型 ${nodeTypeDisplayName(sourceType)} 的连线。`,
      sourcePort: sourceHandle,
      targetPort: targetHandle,
    };
  }

  const sourceConnectionKind = connectionKind(sourcePort);
  const targetConnectionKind = connectionKind(targetPort);
  if (sourceConnectionKind !== targetConnectionKind) {
    return {
      valid: false,
      code: "incompatible_connection_kind",
      message: `输出端口 ${portDisplayName(sourceHandle, sourcePort)} 使用 ${sourceConnectionKind} 通道，不能连接到输入端口 ${portDisplayName(targetHandle, targetPort)} 使用 ${targetConnectionKind} 通道。`,
      sourcePort: sourceHandle,
      targetPort: targetHandle,
      sourceConnectionKind,
      targetConnectionKind,
    };
  }

  const occupiedOutputCount = workflow.edges.filter((edge) => edge.source === source && edge.sourceHandle === sourceHandle).length;
  const maxOutputConnections = sourcePort.maxConnections;
  if (maxOutputConnections !== undefined && maxOutputConnections !== null && occupiedOutputCount >= maxOutputConnections) {
    return {
      valid: false,
      code: "output_connection_limit_reached",
      message: `输出端口 ${portDisplayName(sourceHandle, sourcePort)} 已达到最多 ${maxOutputConnections} 条下游连接的限制。`,
      sourcePort: sourceHandle,
      targetPort: targetHandle,
    };
  }

  const duplicateEdge = workflow.edges.some(
    (edge) =>
      edge.source === source &&
      edge.sourceHandle === sourceHandle &&
      edge.target === target &&
      edge.targetHandle === targetHandle
  );
  if (duplicateEdge) {
    return invalid("duplicate_connection", "这条连线已经存在。");
  }

  const occupiedInputCount = workflow.edges.filter((edge) => edge.target === target && edge.targetHandle === targetHandle).length;
  const maxConnections = targetPort.maxConnections === undefined ? 1 : targetPort.maxConnections;
  if (maxConnections !== null && occupiedInputCount >= maxConnections) {
    return invalid("input_already_connected", `目标输入端口 ${portDisplayName(targetHandle, targetPort)} 已经连接。`);
  }

  const schemaCompatibility = validatePortSchemaCompatibility(sourcePort.schema, targetPort.schema);
  if (!schemaCompatibility.valid) {
    return {
      valid: false,
      code: "incompatible_schema",
      message: `输出端口 ${portDisplayName(sourceHandle, sourcePort)} 的数据类型 ${schemaCompatibility.sourceLabel} 不能连接到输入端口 ${portDisplayName(targetHandle, targetPort)} 的数据类型 ${schemaCompatibility.targetLabel}。`,
      sourcePort: sourceHandle,
      targetPort: targetHandle,
      sourceSchemaLabel: schemaCompatibility.sourceLabel,
      targetSchemaLabel: schemaCompatibility.targetLabel,
    };
  }

  return { valid: true };
}

function invalid(code: ConnectionValidationCode, message: string): ConnectionValidationResult {
  return { valid: false, code, message };
}

function connectionKind(port: { connectionKind?: string }): string {
  return port.connectionKind?.trim() || "data";
}

function portAllowsNodeType(port: { filter?: { nodes?: string[]; excludedNodes?: string[] } }, nodeTypeId: string): boolean {
  const allowed = validNodeTypeIds(port.filter?.nodes);
  const excluded = validNodeTypeIds(port.filter?.excludedNodes);
  if (excluded.has(nodeTypeId)) {
    return false;
  }
  return allowed.size === 0 || allowed.has(nodeTypeId);
}

function validNodeTypeIds(values: string[] | undefined): Set<string> {
  return new Set(values?.filter((value) => value.trim().length > 0) ?? []);
}

function nodeTypeDisplayName(nodeType: NodeType): string {
  return nodeType.displayName?.trim() || nodeType.name || nodeType.id;
}

type PortSchemaCompatibility =
  | { valid: true }
  | { valid: false; sourceLabel: string; targetLabel: string };

function validatePortSchemaCompatibility(
  sourceSchema: JsonSchema | undefined,
  targetSchema: JsonSchema | undefined
): PortSchemaCompatibility {
  const sourceTypes = schemaTypes(sourceSchema);
  const targetTypes = schemaTypes(targetSchema);

  if (sourceTypes.length === 0 || targetTypes.length === 0) {
    return { valid: true };
  }

  if (sourceTypes.some((sourceType) => targetTypes.some((targetType) => isSchemaTypeCompatible(sourceType, targetType)))) {
    return { valid: true };
  }

  return {
    valid: false,
    sourceLabel: sourceTypes.join(" | "),
    targetLabel: targetTypes.join(" | "),
  };
}

function schemaTypes(schema: JsonSchema | undefined): string[] {
  return schema ? schemaFieldTypes(schema) : [];
}

function isSchemaTypeCompatible(sourceType: string, targetType: string): boolean {
  if (sourceType === targetType) {
    return true;
  }

  return sourceType === "integer" && targetType === "number";
}
