import type { WorkflowDocument } from "@/types";

export type RunParameter = {
  name: string;
  label?: string;
  type?: "string" | "file" | "date" | "number" | "integer" | "boolean" | "json";
  required?: boolean;
  default?: unknown;
  options?: string[];
  description?: string;
};

export function runParameterDeclaration(workflow: WorkflowDocument): { fields: RunParameter[]; input_path?: string } | null {
  const node = workflow.nodes.find((item) => item.type === "workflow.parameters");
  if (!node) return null;
  if (!Array.isArray(node.config.fields)) throw new Error("请先配置运行参数定义");
  return { fields: node.config.fields as RunParameter[], input_path: String(node.config.input_path ?? "") };
}

export function parameterInput(fields: RunParameter[], values: Record<string, string>, inputPath = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.name] ?? "";
    if (!value && field.type !== "boolean") {
      if (field.required !== false) throw new Error(`请填写${field.label || field.name}`);
      continue;
    }
    if (field.type === "boolean") result[field.name] = value === "true";
    else if (field.type === "json") result[field.name] = JSON.parse(value);
    else if (field.type === "number" || field.type === "integer") {
      const number = Number(value);
      if (!Number.isFinite(number) || (field.type === "integer" && !Number.isInteger(number))) throw new Error(`${field.label || field.name}需要有效数字`);
      result[field.name] = number;
    } else result[field.name] = value;
  }
  return inputPath.split(".").filter(Boolean).reduceRight<Record<string, unknown>>((value, key) => ({ [key]: value }), result);
}
