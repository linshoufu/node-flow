import { useCallback, useRef, useState } from "react";
import { updateNodeExecutionPolicy } from "../lib/executionPolicy";
import {
  createCanvasAnnotation,
  createWorkflowNode,
  duplicateWorkflowNodes,
  getEditableWorkflow,
  nextWorkflowNodePosition,
  updateEditableWorkflow,
  type EditScope,
} from "../lib/workflow";
import {
  createWorkflowNodeClipboard,
  parseWorkflowNodeClipboard,
  pasteWorkflowNodeClipboard,
  serializeWorkflowNodeClipboard,
  type WorkflowNodeClipboard,
} from "../lib/workflowClipboard";
import type {
  NodeExecutionPolicy,
  NodeType,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowSubflow,
} from "../types";

type DeletedEdgesUndo = {
  editScope: EditScope;
  edges: WorkflowEdge[];
};

type SelectNode = (
  nodeId: string | null,
  tab?: "config" | "runtime",
  field?: string,
  nodeIds?: string[],
) => void;

type UseCanvasOperationsOptions = {
  clearValidationIssues: () => void;
  commitWorkflowChange: (updater: (current: WorkflowDocument) => WorkflowDocument) => void;
  documentKey: string;
  editableWorkflow: WorkflowSubflow;
  editScope: EditScope;
  isEditorLocked: boolean;
  onMessage: (message: string) => void;
  selectNode: SelectNode;
};

export function useCanvasOperations({
  clearValidationIssues,
  commitWorkflowChange,
  documentKey,
  editableWorkflow,
  editScope,
  isEditorLocked,
  onMessage,
  selectNode,
}: UseCanvasOperationsOptions) {
  const [deletedEdgesUndo, setDeletedEdgesUndo] = useState<DeletedEdgesUndo | null>(null);
  const [hasNodeClipboard, setHasNodeClipboard] = useState(false);
  const workflowNodeClipboardRef = useRef<WorkflowNodeClipboard | null>(null);
  const editorStateRef = useRef({ documentKey, isEditorLocked });
  editorStateRef.current = { documentKey, isEditorLocked };

  const commitEditableChange = useCallback((
    updater: (current: WorkflowSubflow) => WorkflowSubflow,
    targetScope: EditScope = editScope,
  ) => {
    commitWorkflowChange((current) => {
      const currentEditableWorkflow = getEditableWorkflow(current, targetScope);
      return updateEditableWorkflow(current, targetScope, updater(currentEditableWorkflow));
    });
  }, [commitWorkflowChange, editScope]);

  const addNodeAt = useCallback((nodeType: NodeType, position: { x: number; y: number }) => {
    if (isEditorLocked) {
      return;
    }

    const nextNode = createWorkflowNode(nodeType, position);
    clearValidationIssues();
    commitEditableChange((current) => ({
      ...current,
      nodes: [...current.nodes, nextNode],
    }));
    selectNode(nextNode.id);
  }, [clearValidationIssues, commitEditableChange, isEditorLocked, selectNode]);

  const addNode = useCallback((nodeType: NodeType) => {
    addNodeAt(nodeType, nextWorkflowNodePosition(editableWorkflow.nodes.length));
  }, [addNodeAt, editableWorkflow.nodes.length]);

  const addCanvasAnnotation = useCallback((position: { x: number; y: number }) => {
    if (isEditorLocked) {
      return;
    }

    const annotation = createCanvasAnnotation(position);
    commitEditableChange((current) => ({
      ...current,
      annotations: [...(current.annotations ?? []), annotation],
    }));
  }, [commitEditableChange, isEditorLocked]);

  const duplicateSelectedNodes = useCallback((nodeIds: string[]) => {
    if (isEditorLocked || nodeIds.length === 0) {
      return;
    }

    const duplicate = duplicateWorkflowNodes(editableWorkflow.nodes, editableWorkflow.edges, nodeIds);
    if (duplicate.nodes.length === 0) {
      return;
    }

    clearValidationIssues();
    commitEditableChange((current) => ({
      ...current,
      nodes: [...current.nodes, ...duplicate.nodes],
      edges: [...current.edges, ...duplicate.edges],
    }));
    const duplicatedNodeIds = duplicate.nodes.map((node) => node.id);
    selectNode(duplicatedNodeIds[0] ?? null, "config", undefined, duplicatedNodeIds);
    onMessage(
      duplicatedNodeIds.length === 1
        ? "已复制所选节点。"
        : `已复制 ${duplicatedNodeIds.length} 个所选节点。`,
    );
  }, [
    clearValidationIssues,
    commitEditableChange,
    editableWorkflow.edges,
    editableWorkflow.nodes,
    isEditorLocked,
    onMessage,
    selectNode,
  ]);

  const copySelectedNodes = useCallback((nodeIds: string[]) => {
    if (isEditorLocked || nodeIds.length === 0) {
      return;
    }

    const clipboard = createWorkflowNodeClipboard(editableWorkflow.nodes, editableWorkflow.edges, nodeIds);
    if (clipboard.nodes.length === 0) {
      return;
    }

    workflowNodeClipboardRef.current = clipboard;
    setHasNodeClipboard(true);
    void writeWorkflowNodeClipboard(clipboard);
    onMessage(
      clipboard.nodes.length === 1
        ? "已复制所选节点。"
        : `已复制 ${clipboard.nodes.length} 个节点及内部连线。`,
    );
  }, [editableWorkflow.edges, editableWorkflow.nodes, isEditorLocked, onMessage]);

  const pasteCopiedNodes = useCallback(async () => {
    if (isEditorLocked) {
      return;
    }

    const requestedDocumentKey = documentKey;
    const clipboard = workflowNodeClipboardRef.current ?? (await readWorkflowNodeClipboard());
    if (
      editorStateRef.current.documentKey !== requestedDocumentKey
      || editorStateRef.current.isEditorLocked
    ) {
      return;
    }
    if (!clipboard || clipboard.nodes.length === 0) {
      onMessage("请先复制 Node Flow 节点。");
      return;
    }

    workflowNodeClipboardRef.current = clipboard;
    setHasNodeClipboard(true);
    const pasted = pasteWorkflowNodeClipboard(clipboard);
    if (pasted.nodes.length === 0) {
      onMessage("剪贴板中的节点无法粘贴。");
      return;
    }

    clearValidationIssues();
    commitEditableChange((current) => ({
      ...current,
      nodes: [...current.nodes, ...pasted.nodes],
      edges: [...current.edges, ...pasted.edges],
    }));
    const pastedNodeIds = pasted.nodes.map((node) => node.id);
    selectNode(pastedNodeIds[0] ?? null, "config", undefined, pastedNodeIds);
    onMessage(
      pastedNodeIds.length === 1
        ? "已粘贴节点。"
        : `已粘贴 ${pastedNodeIds.length} 个节点及内部连线。`,
    );
  }, [
    clearValidationIssues,
    commitEditableChange,
    documentKey,
    isEditorLocked,
    onMessage,
    selectNode,
  ]);

  const updateNodeConfig = useCallback((nodeId: string, key: string, value: unknown) => {
    if (isEditorLocked) {
      return;
    }

    clearValidationIssues();
    commitEditableChange((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId ? { ...node, config: { ...node.config, [key]: value } } : node
      ),
    }));
  }, [clearValidationIssues, commitEditableChange, isEditorLocked]);

  const updateNodeLabel = useCallback((nodeId: string, label: string) => {
    if (isEditorLocked) {
      return;
    }

    commitEditableChange((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, label } : node)),
    }));
  }, [commitEditableChange, isEditorLocked]);

  const updateNodeNotes = useCallback((nodeId: string, notes: string) => {
    if (isEditorLocked) {
      return;
    }

    commitEditableChange((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, notes } : node)),
    }));
  }, [commitEditableChange, isEditorLocked]);

  const updateNodeDisabled = useCallback((nodeId: string, disabled: boolean) => {
    if (isEditorLocked) {
      return;
    }

    clearValidationIssues();
    commitEditableChange((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, disabled } : node)),
    }));
  }, [clearValidationIssues, commitEditableChange, isEditorLocked]);

  const updateNodeFailurePolicy = useCallback((nodeId: string, policy: NodeExecutionPolicy) => {
    if (isEditorLocked) {
      return;
    }

    clearValidationIssues();
    commitEditableChange((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId ? updateNodeExecutionPolicy(node, policy) : node
      ),
    }));
  }, [clearValidationIssues, commitEditableChange, isEditorLocked]);

  const updateNodePinnedData = useCallback((
    nodeId: string,
    pinnedData: Record<string, unknown> | undefined,
  ) => {
    if (isEditorLocked) {
      return;
    }

    clearValidationIssues();
    commitEditableChange((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, ...(pinnedData ? { pinnedData } : { pinnedData: undefined }) }
          : node
      ),
    }));
  }, [clearValidationIssues, commitEditableChange, isEditorLocked]);

  const removeNodeConfig = useCallback((nodeId: string, key: string) => {
    if (isEditorLocked) {
      return;
    }

    clearValidationIssues();
    commitEditableChange((current) => ({
      ...current,
      nodes: current.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }
        const { [key]: _removed, ...nextConfig } = node.config;
        return { ...node, config: nextConfig };
      }),
    }));
  }, [clearValidationIssues, commitEditableChange, isEditorLocked]);

  const removeWorkflowEdges = useCallback((edgeIds: string[]) => {
    if (isEditorLocked) {
      return;
    }

    const edgeIdsToRemove = new Set(edgeIds);
    if (edgeIdsToRemove.size === 0) {
      return;
    }

    const deletedEdges = editableWorkflow.edges.filter((edge) => edgeIdsToRemove.has(edge.id));
    if (deletedEdges.length === 0) {
      return;
    }

    clearValidationIssues();
    setDeletedEdgesUndo({ editScope, edges: deletedEdges });
    commitEditableChange((current) => ({
      ...current,
      edges: current.edges.filter((edge) => !edgeIdsToRemove.has(edge.id)),
    }));
    onMessage(
      deletedEdges.length === 1
        ? `已删除连线 ${deletedEdges[0].id}。`
        : `已删除 ${deletedEdges.length} 条无效连线。`,
    );
  }, [
    clearValidationIssues,
    commitEditableChange,
    editScope,
    editableWorkflow.edges,
    isEditorLocked,
    onMessage,
  ]);

  const removeWorkflowEdge = useCallback((edgeId: string) => {
    removeWorkflowEdges([edgeId]);
  }, [removeWorkflowEdges]);

  const undoDeletedEdges = useCallback(() => {
    if (isEditorLocked || !deletedEdgesUndo) {
      return;
    }

    const undoSnapshot = deletedEdgesUndo;
    clearValidationIssues();
    commitEditableChange((current) => {
      const currentEdgeIds = new Set(current.edges.map((edge) => edge.id));
      const restoredEdges = undoSnapshot.edges.filter((edge) => !currentEdgeIds.has(edge.id));
      return {
        ...current,
        edges: [...current.edges, ...restoredEdges],
      };
    }, undoSnapshot.editScope);
    setDeletedEdgesUndo(null);
    onMessage(`已恢复 ${undoSnapshot.edges.length} 条连线。`);
  }, [
    clearValidationIssues,
    commitEditableChange,
    deletedEdgesUndo,
    isEditorLocked,
    onMessage,
  ]);

  const clearDeletedEdgesUndo = useCallback(() => {
    setDeletedEdgesUndo(null);
  }, []);

  const repairWorkflowEdgeTarget = useCallback((edgeId: string, targetHandle: string) => {
    if (isEditorLocked) {
      return;
    }

    clearValidationIssues();
    setDeletedEdgesUndo(null);
    commitEditableChange((current) => ({
      ...current,
      edges: current.edges.map((edge) =>
        edge.id === edgeId ? { ...edge, targetHandle } : edge
      ),
    }));
    onMessage(`已将连线 ${edgeId} 改接到输入端口 ${targetHandle}。`);
  }, [clearValidationIssues, commitEditableChange, isEditorLocked, onMessage]);

  const updateCurrentEditableWorkflow = useCallback((nextWorkflow: WorkflowDocument) => {
    if (isEditorLocked) {
      return;
    }

    clearValidationIssues();
    commitEditableChange(() => ({
      nodes: nextWorkflow.nodes,
      edges: nextWorkflow.edges,
      annotations: nextWorkflow.annotations ?? [],
    }));
  }, [clearValidationIssues, commitEditableChange, isEditorLocked]);

  return {
    addCanvasAnnotation,
    addNode,
    addNodeAt,
    canUndoDeletedEdges: deletedEdgesUndo !== null,
    clearDeletedEdgesUndo,
    copySelectedNodes,
    duplicateSelectedNodes,
    hasNodeClipboard,
    pasteCopiedNodes,
    removeNodeConfig,
    removeWorkflowEdge,
    removeWorkflowEdges,
    repairWorkflowEdgeTarget,
    undoDeletedEdges,
    updateCurrentEditableWorkflow,
    updateNodeConfig,
    updateNodeDisabled,
    updateNodeFailurePolicy,
    updateNodeLabel,
    updateNodeNotes,
    updateNodePinnedData,
  };
}

async function writeWorkflowNodeClipboard(clipboard: WorkflowNodeClipboard): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return;
  }

  try {
    await navigator.clipboard.writeText(serializeWorkflowNodeClipboard(clipboard));
  } catch {
    // The in-memory clipboard keeps same-tab copy and paste available when permission is denied.
  }
}

async function readWorkflowNodeClipboard(): Promise<WorkflowNodeClipboard | null> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
    return null;
  }

  try {
    return parseWorkflowNodeClipboard(await navigator.clipboard.readText());
  } catch {
    return null;
  }
}
