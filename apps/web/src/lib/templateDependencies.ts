import type { NodeTemplate, WorkflowDocument } from "@/types";
import { runParameterDeclaration } from "./runParameters";

export function templateDependencyIssue(template: NodeTemplate, workflow: WorkflowDocument): string {
  let fields;
  try { fields = runParameterDeclaration(workflow)?.fields ?? []; } catch { return "请先修正运行参数定义"; }
  for (const required of template.parameters ?? []) {
    const current = fields.find((field) => field.name === required.name);
    if (!current || (current.type ?? "string") !== (required.type ?? "string")) return `需先声明${required.label || required.name}运行参数（${required.type || "string"}）`;
  }
  for (const field of template.configuration ?? []) {
    const current = workflow.settings?.configuration?.find((item) => item.name === field.name);
    if (template.source === "user" && current && ((current.type ?? "string") !== (field.type ?? "string") || JSON.stringify(current.default) !== JSON.stringify(field.default))) return `工作流配置“${field.label || field.name}”已存在不同定义`;
  }
  for (const [name, value] of Object.entries(template.variables ?? {})) {
    if (template.source === "user" && Object.hasOwn(workflow.settings?.variables ?? {}, name) && JSON.stringify(workflow.settings?.variables?.[name]) !== JSON.stringify(value)) return `工作流变量“${name}”已存在不同值`;
  }
  if (template.kind === "node" && template.node?.type === "workflow.parameters" && workflow.nodes.some((node) => node.type === "workflow.parameters")) return "工作流已包含运行参数节点";
  return "";
}
