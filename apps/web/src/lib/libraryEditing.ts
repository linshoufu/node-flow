import type { NodeTemplate, WorkflowDocument } from "@/types";
import { useWorkflowStore, type CanvasScopeSegment } from "@/store/workflow";
import { templateDraft } from "./templateLibrary";

export type LibraryEditSession = {
  asset: NodeTemplate;
  targetNodeId: string | null;
  parameterNodeId: string | null;
  targetScope: CanvasScopeSegment[];
  backup: Pick<ReturnType<typeof useWorkflowStore.getState>, "workflow" | "selectedNodeId" | "canvasScope" | "isDirty" | "saveError">;
};
export function libraryChanged() { window.dispatchEvent(new Event("nodeflow:library-changed")); }
export function beginLibraryEdit(asset: NodeTemplate) {
  const state = useWorkflowStore.getState();
  if (asset.source !== "user" || asset.deletedAt) throw new Error("只能编辑未删除的个人资源");
  if (state.libraryEdit || state.isSaving) throw new Error("请先结束当前编辑或保存操作");
  const copy = structuredClone(asset);
  const id = `library-edit:${asset.id}`;
  let draft: WorkflowDocument = { id, name: asset.name, version: 1, active: false, nodes: [], edges: [], settings: { timeout_seconds: 600, run_mode: "preview", configuration: copy.configuration ?? [], variables: copy.variables ?? {} } };
  let scope: CanvasScopeSegment[] = [];
  let parameterNodeId: string | null = null;
  if (asset.kind === "workflow") draft = { ...copy.workflow!, id, active: false, settings: { timeout_seconds: 600, ...copy.workflow?.settings, run_mode: "preview" } };
  else {
    if (asset.kind === "node") draft.nodes = [copy.node!];
    else {
      const owner = "library-loop";
      draft.nodes = [{ id: owner, type: "control.each_item", position: { x: 0, y: 0 }, config: {}, subflows: { body: copy.graph! } }];
      scope = [{ nodeId: owner, key: "body", label: asset.name }];
    }
    if (copy.parameters?.length && !draft.nodes.some((node) => node.type === "workflow.parameters")) { parameterNodeId = `library-parameters:${crypto.randomUUID()}`; draft.nodes.push({ id: parameterNodeId, type: "workflow.parameters", typeVersion: 2, label: "预设所需运行参数", position: { x: -280, y: 0 }, config: { fields: copy.parameters.map((field) => ({ ...field, label: field.label || field.name })) } }); }
  }
  const session: LibraryEditSession = { asset: copy, parameterNodeId, targetNodeId: asset.kind === "node" ? copy.node!.id : null, targetScope: scope, backup: { workflow: state.workflow, selectedNodeId: state.selectedNodeId, canvasScope: state.canvasScope, isDirty: state.isDirty, saveError: state.saveError } };
  useWorkflowStore.setState({ workflow: draft, canvasScope: scope, selectedNodeId: asset.kind === "subflow" ? copy.graph!.nodes[0]?.id ?? null : draft.nodes[0]?.id ?? null, isDirty: false, saveError: null, libraryEdit: session });
}
export function editedTemplateDraft() {
  const { libraryEdit: session, workflow } = useWorkflowStore.getState();
  if (!session) throw new Error("当前没有资源编辑草稿");
  if (session.asset.kind === "node" && workflow.nodes.some((node) => node.id !== session.targetNodeId && node.id !== session.parameterNodeId)) throw new Error("单节点预设仅允许一个主节点，请移除额外节点或另存为流程模板");
  return templateDraft(workflow, session.targetScope, session.targetNodeId, session.asset.kind);
}
export function finishLibraryEdit() {
  const session = useWorkflowStore.getState().libraryEdit;
  if (session) useWorkflowStore.setState({ ...session.backup, isSaving: false, libraryEdit: null });
}
