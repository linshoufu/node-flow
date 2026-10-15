import type { NodeTemplate, WorkflowDocument } from "@/types";
import { getActiveGraph, type CanvasScopeSegment } from "@/store/workflow";
import { runParameterDeclaration } from "./runParameters";

export type TemplateDraft = Pick<NodeTemplate, "name" | "description" | "kind" | "node" | "graph" | "workflow" | "configuration" | "parameters" | "variables">;
export function templateDraft(workflow: WorkflowDocument, scope: CanvasScopeSegment[], selected: string | null, kind: NodeTemplate["kind"]): TemplateDraft {
  const graph = getActiveGraph(workflow, scope);
  const node = graph.nodes.find((node) => node.id === selected);
  if (kind === "node" && !node) throw new Error("请先选中要保存的节点");
  if (kind === "subflow" && !scope.length) throw new Error("请先进入要保存的循环体");
  if (kind !== "node" && !(kind === "workflow" ? workflow.nodes : graph.nodes).length) throw new Error("不能保存空白模板");
  if (kind === "workflow") return { kind, name: workflow.name, workflow: structuredClone(workflow) };
  const body = kind === "node" ? { nodes: [node!], edges: [] } : graph;
  const names = new Set<string>();
  let needsParameters = false;
  function visit(nodes: typeof graph.nodes) {
    for (const node of nodes) {
      for (const binding of Object.values(node.configBindings ?? {})) {
        if (binding.source === "workflow") names.add(binding.key); else needsParameters = true;
      }
      if (JSON.stringify(node.config).includes("run_parameters")) needsParameters = true;
      for (const subflow of Object.values(node.subflows ?? {})) visit(subflow.nodes);
    }
  }
  visit(body.nodes);
  return structuredClone({ kind, name: node?.label || "", ...(kind === "node" ? { node } : { graph: body }), configuration: (workflow.settings?.configuration ?? []).filter((field) => names.has(field.name)), parameters: needsParameters ? runParameterDeclaration(workflow)?.fields ?? [] : [], variables: workflow.settings?.variables ?? {} });
}
