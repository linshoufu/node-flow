import type { NodePort, NodeType, WorkflowNode } from "../types";

const PORT_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type DynamicPortConfigurationIssue = {
  field: string;
  message: string;
};

export function resolveNodeInputPorts(node: WorkflowNode, nodeType: NodeType): Record<string, NodePort> {
  const dynamic = nodeType.dynamicInputs;
  if (!dynamic) {
    return nodeType.inputs;
  }

  const entries = node.config[dynamic.configKey];
  if (!Array.isArray(entries)) {
    return nodeType.inputs;
  }

  const inputs: Record<string, NodePort> = { ...nodeType.inputs };
  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = entry[dynamic.idKey];
    const label = entry[dynamic.labelKey];
    if (typeof id !== "string" || !PORT_ID.test(id) || id in inputs) {
      continue;
    }
    inputs[id] = {
      ...dynamic.input,
      ...(typeof label === "string" && label.trim() ? { displayName: label.trim() } : {}),
    };
  }
  return inputs;
}

export function resolveNodeOutputPorts(node: WorkflowNode, nodeType: NodeType): Record<string, NodePort> {
  const dynamic = nodeType.dynamicOutputs;
  if (!dynamic) {
    return nodeType.outputs;
  }

  const rules = node.config[dynamic.configKey];
  if (!Array.isArray(rules)) {
    return nodeType.outputs;
  }

  const outputs: Record<string, NodePort> = { ...nodeType.outputs };
  for (const rule of rules) {
    if (!isRecord(rule)) {
      continue;
    }
    const id = rule[dynamic.idKey];
    const label = rule[dynamic.labelKey];
    if (typeof id !== "string" || !PORT_ID.test(id) || id in outputs) {
      continue;
    }
    outputs[id] = {
      ...dynamic.output,
      ...(typeof label === "string" && label.trim() ? { displayName: label.trim() } : {}),
    };
  }
  return outputs;
}

export function dynamicPortConfigurationIssues(
  node: WorkflowNode,
  nodeType: NodeType
): DynamicPortConfigurationIssue[] {
  return [
    ...dynamicPortIssues(node, nodeType.dynamicInputs, nodeType.inputs, "输入"),
    ...dynamicPortIssues(node, nodeType.dynamicOutputs, nodeType.outputs, "输出"),
  ];
}

function dynamicPortIssues(
  node: WorkflowNode,
  dynamic:
    | { configKey: string; idKey: string; labelKey: string }
    | null
    | undefined,
  staticPorts: Record<string, NodePort>,
  direction: string
): DynamicPortConfigurationIssue[] {
  if (!dynamic || !(dynamic.configKey in node.config)) {
    return [];
  }
  const entries = node.config[dynamic.configKey];
  if (!Array.isArray(entries)) {
    return [{ field: dynamic.configKey, message: `动态${direction}端口配置必须是数组。` }];
  }

  const issues: DynamicPortConfigurationIssue[] = [];
  const seenIds = new Set(Object.keys(staticPorts));
  for (const [index, entry] of entries.entries()) {
    if (!isRecord(entry)) {
      issues.push({ field: dynamic.configKey, message: `第 ${index + 1} 个动态${direction}端口配置必须是对象。` });
      continue;
    }
    const id = entry[dynamic.idKey];
    if (typeof id !== "string" || !PORT_ID.test(id)) {
      issues.push({ field: dynamic.configKey, message: `第 ${index + 1} 个动态${direction}端口 ID 必须使用字母、数字或下划线。` });
      continue;
    }
    if (seenIds.has(id)) {
      issues.push({ field: dynamic.configKey, message: `动态${direction}端口 ID ${id} 与已有端口重复。` });
      continue;
    }
    seenIds.add(id);

    if (dynamic.labelKey in entry) {
      const label = entry[dynamic.labelKey];
      if (typeof label !== "string" || !label.trim()) {
        issues.push({ field: dynamic.configKey, message: `第 ${index + 1} 个动态${direction}端口名称不能为空。` });
      }
    }
  }
  return issues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
