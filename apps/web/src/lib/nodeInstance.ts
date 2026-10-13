import type { NodePort, NodeType, WorkflowNode } from "@/types";

export function nodeConfigDefaults(type: NodeType): Record<string, unknown> {
  return Object.fromEntries(Object.entries(type.configSchema.properties ?? {}).filter(([, field]) => "default" in field).map(([key, field]) => [key, structuredClone(field.default)]));
}

export function createNodeInstance(type: NodeType, id: string, position: WorkflowNode["position"]): WorkflowNode {
  return { id, type: type.id, position, config: nodeConfigDefaults(type), ...(["control.each_item", "control.foreach", "control.while"].includes(type.id) ? { subflows: { body: { nodes: [], edges: [] } } } : {}) };
}

/** Mirror declarative dynamic-port metadata, retaining the static ports on invalid configuration. */
export function resolveNodePorts(type: NodeType, config: Record<string, unknown>, direction: "inputs" | "outputs"): Record<string, NodePort> {
  const ports = { ...type[direction] };
  const spec = direction === "inputs" ? type.dynamicInputs : type.dynamicOutputs;
  if (!spec) return ports;
  const values = config[spec.configKey] === undefined ? type.configSchema.properties?.[spec.configKey]?.default ?? spec.defaultItems : config[spec.configKey];
  if (!Array.isArray(values)) return ports;
  const dynamic: Record<string, NodePort> = {};
  for (const item of values) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return ports;
    const id = item[spec.idKey];
    const label = item[spec.labelKey];
    if (typeof id !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(id) || typeof label !== "string" || !label.trim() || Object.hasOwn(ports, id) || Object.hasOwn(dynamic, id)) return ports;
    const prototype = direction === "inputs" ? type.dynamicInputs!.input : type.dynamicOutputs!.output;
    Object.defineProperty(dynamic, id, { value: { ...prototype, displayName: label }, enumerable: true, configurable: true });
  }
  return { ...ports, ...dynamic };
}
