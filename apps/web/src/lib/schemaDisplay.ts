import type { JsonSchema, NodePort } from "../types";
import { schemaFieldTypes } from "./jsonSchema";

const COMMON_PORT_LABELS: Record<string, string> = {
  body: "请求体",
  done: "完成",
  error: "错误",
  failed: "失败",
  false: "否",
  headers: "请求头",
  input: "输入",
  max_reached: "达到上限",
  output: "输出",
  passed: "通过",
  report: "报告",
  result: "结果",
  rows: "行数据",
  success: "成功",
  summary: "汇总",
  true: "是",
  value: "值",
};

export type SchemaSummary = {
  typeLabel: string;
  fieldLabel?: string;
  requiredLabel?: string;
};

export function schemaSummary(schema: JsonSchema | undefined): SchemaSummary {
  if (!schema) {
    return { typeLabel: "任意" };
  }

  const types = schemaFieldTypes(schema);
  const typeLabel = schemaTypeLabel(schema, types);
  const fields = schema.properties ? Object.keys(schema.properties) : [];
  const required = schema.required ?? [];

  return {
    typeLabel,
    ...(fields.length ? { fieldLabel: `字段：${fields.join(", ")}` } : {}),
    ...(required.length ? { requiredLabel: `必填：${required.join(", ")}` } : {}),
  };
}

export function portTooltip({
  direction,
  name,
  port,
}: {
  direction: "input" | "output";
  name: string;
  port: NodePort;
}): string {
  const summary = schemaSummary(port.schema);
  const label = portDisplayName(name, port);
  const parts = [direction === "input" ? `输入端口 ${label}` : `输出端口 ${label}`, summary.typeLabel];

  if (port.description) {
    parts.push(port.description);
  }
  const connectionKindLabel = portConnectionKindLabel(port.connectionKind);
  if (connectionKindLabel) {
    parts.push(`通道：${connectionKindLabel}`);
  }
  const capacityLabel = inputCapacityLabel(direction, port);
  if (capacityLabel) {
    parts.push(capacityLabel);
  }
  const dataModeLabel = portDataModeLabel(port);
  if (direction === "input" && dataModeLabel) {
    parts.push(dataModeLabel);
  }
  if (summary.fieldLabel) {
    parts.push(summary.fieldLabel);
  }
  if (summary.requiredLabel) {
    parts.push(summary.requiredLabel);
  }

  return parts.join(" · ");
}

export function portDisplayName(name: string, port: NodePort): string {
  return port.displayName || COMMON_PORT_LABELS[name] || name;
}

export function inputCapacityLabel(
  direction: "input" | "output",
  port: NodePort,
  options: { includeDefault?: boolean } = {}
): string | null {
  const { includeDefault = false } = options;

  if (direction === "output") {
    if (port.maxConnections === undefined || port.maxConnections === null) {
      return null;
    }
    return `最多 ${port.maxConnections} 条下游连接`;
  }

  if (direction !== "input") {
    return null;
  }

  if (port.maxConnections === undefined || port.maxConnections === 1) {
    return includeDefault ? "单连接" : null;
  }
  if (port.maxConnections === null) {
    return "不限连接";
  }
  return `最多 ${port.maxConnections} 条连接`;
}

export function portDataModeLabel(port: NodePort): string | null {
  return port.dataMode === "items" ? "数据：多条 item" : null;
}

function portConnectionKindLabel(connectionKind: string | undefined): string | null {
  const normalized = connectionKind?.trim();
  if (!normalized || normalized === "data") {
    return null;
  }

  return connectionKindDisplayLabel(normalized);
}

export function connectionKindDisplayLabel(connectionKind: string | undefined): string {
  const normalized = connectionKind?.trim() || "data";
  return {
    data: "数据",
    resource: "资源",
    tool: "工具",
    trigger: "触发",
  }[normalized] ?? normalized;
}

function schemaTypeLabel(schema: JsonSchema, types: string[]): string {
  if (types.length === 0) {
    return "任意";
  }

  if (types.length === 1 && types[0] === "array") {
    const itemType = itemSchemaTypeLabel(schema.items);
    return itemType ? `array<${itemType}>` : "array";
  }

  return types.join(" / ");
}

function itemSchemaTypeLabel(items: JsonSchema | JsonSchema[] | undefined): string | undefined {
  if (!items || Array.isArray(items)) {
    return undefined;
  }

  const itemTypes = schemaFieldTypes(items);
  return itemTypes.length ? itemTypes.join(" / ") : "任意";
}
