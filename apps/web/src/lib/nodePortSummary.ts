import type { NodePort, NodeType } from "../types";

export type NodePortContractSummary = {
  labels: string[];
  searchText: string;
  text: string;
};

export function nodePortContractSummary(nodeType: NodeType): NodePortContractSummary {
  const inputPorts = [...Object.entries(nodeType.inputs), ...defaultDynamicInputPorts(nodeType)];
  const outputPorts = Object.entries(nodeType.outputs);
  const requiredInputCount = inputPorts.filter(([, port]) => port.required).length;
  const supportsMultipleConnections = inputPorts.some(([, port]) =>
    port.maxConnections === null || (typeof port.maxConnections === "number" && port.maxConnections > 1),
  );

  const labels = [nodeKindLabel(nodeType), `输入 ${inputPorts.length}`, `输出 ${outputPorts.length}`];

  if (requiredInputCount > 0) {
    labels.push(`必填输入 ${requiredInputCount}`);
  }

  if (nodeType.dynamicInputs) {
    labels.push("可配置输入");
  }

  if (supportsMultipleConnections) {
    labels.push("支持多连接");
  }

  const inputDisplayNames = portDisplayNames(inputPorts);
  const outputDisplayNames = portDisplayNames(outputPorts);
  const details = [
    ...(inputDisplayNames.length ? [`输入：${inputDisplayNames.join("、")}`] : []),
    ...(outputDisplayNames.length ? [`输出：${outputDisplayNames.join("、")}`] : []),
  ];
  const searchTokens = [...labels, ...inputDisplayNames, ...outputDisplayNames];

  return {
    labels,
    searchText: searchTokens.join(" "),
    text: [...labels, ...details].join(" · "),
  };
}

function defaultDynamicInputPorts(nodeType: NodeType): Array<[string, NodePort]> {
  const definition = nodeType.dynamicInputs;
  if (!definition?.defaultItems) {
    return [];
  }

  const staticPortNames = new Set(Object.keys(nodeType.inputs));
  const entries: Array<[string, NodePort]> = [];
  for (const item of definition.defaultItems) {
    const id = item[definition.idKey];
    const label = item[definition.labelKey];
    if (typeof id !== "string" || !id || staticPortNames.has(id) || entries.some(([name]) => name === id)) {
      continue;
    }
    entries.push([
      id,
      {
        ...definition.input,
        ...(typeof label === "string" && label.trim() ? { displayName: label.trim() } : {}),
      },
    ]);
  }
  return entries;
}

function portDisplayNames(ports: Array<[string, { displayName?: string }]>): string[] {
  return ports.map(([, port]) => port.displayName).filter((name): name is string => Boolean(name));
}

function nodeKindLabel(nodeType: NodeType): string {
  const group = nodeType.group?.toLowerCase();
  if (group === "trigger") {
    return "触发器";
  }
  if (group === "control") {
    return "控制节点";
  }
  return "动作";
}
