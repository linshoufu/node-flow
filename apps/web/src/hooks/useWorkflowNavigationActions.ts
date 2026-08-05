import { useCallback, useEffect, useRef } from "react";
import type { ApiClient } from "../api/client";
import { apiClient } from "../api/client";
import { formatApiError } from "../lib/apiError";
import { createEmptyWorkflow, normalizeWorkflowDocument } from "../lib/workflow";
import type { WorkflowRoute } from "../lib/workflowRoute";
import type { WorkflowDocument } from "../types";
import type { WorkflowRouteRequestSource } from "./useWorkflowRouteController";

export type WorkflowNavigationDocumentRequest = {
  baseline: "clean" | "dirty";
  message: string;
  selectedNodeId: string | null;
  selectedWorkflowId: string;
  workflow: WorkflowDocument;
};

export type LoadWorkflowOptions = {
  confirmDiscard?: boolean;
  nodeId?: string;
  updateRoute?: boolean;
};

export type ResetWorkflowOptions = {
  updateRoute?: boolean;
};

type WorkflowNavigationClient = Pick<ApiClient, "deleteWorkflow" | "getWorkflow">;

type UseWorkflowNavigationActionsOptions = {
  client?: WorkflowNavigationClient;
  createWorkflowFromTemplate: (templateId: string) => WorkflowDocument;
  hasActiveOperation: () => boolean;
  isBusy: boolean;
  isCancelling: boolean;
  isWorkflowDirty: boolean;
  navigate: (route: WorkflowRoute) => void;
  onApplyDocument: (request: WorkflowNavigationDocumentRequest) => void;
  onBusyChange: (busy: boolean) => void;
  onMessage: (message: string) => void;
  openHistoricalRun: (
    runId: string,
    options: {
      expectedWorkflowId: string;
      nodeId?: string;
      updateRoute: false;
    },
  ) => Promise<WorkflowRoute | null>;
  refreshWorkflowCatalog: () => Promise<unknown>;
  selectedWorkflowId: string;
  selectTemplateNode: (templateId: string) => string | null;
};

export type WorkflowNavigationActions = {
  applyTemplate: (templateId: string) => void;
  confirmDiscardUnsavedChanges: () => boolean;
  deleteWorkflow: (workflowId: string) => Promise<void>;
  handleRouteRequest: (
    route: WorkflowRoute,
    source: WorkflowRouteRequestSource,
  ) => Promise<WorkflowRoute | null>;
  loadWorkflow: (
    workflowId: string,
    options?: LoadWorkflowOptions,
  ) => Promise<WorkflowRoute | null>;
  resetEditorForNewWorkflow: (message: string, options?: ResetWorkflowOptions) => void;
  startNewWorkflow: () => void;
};

export function useWorkflowNavigationActions({
  client = apiClient,
  createWorkflowFromTemplate,
  hasActiveOperation,
  isBusy,
  isCancelling,
  isWorkflowDirty,
  navigate,
  onApplyDocument,
  onBusyChange,
  onMessage,
  openHistoricalRun,
  refreshWorkflowCatalog,
  selectedWorkflowId,
  selectTemplateNode,
}: UseWorkflowNavigationActionsOptions): WorkflowNavigationActions {
  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestRef.current += 1;
    };
  }, []);

  const confirmDiscardUnsavedChanges = useCallback((): boolean => {
    if (!isWorkflowDirty) {
      return true;
    }

    const confirmed = window.confirm("当前工作流有未保存变更，继续会丢弃这些修改。是否继续？");
    if (!confirmed) {
      onMessage("已保留当前未保存修改。");
    }
    return confirmed;
  }, [isWorkflowDirty, onMessage]);

  const resetEditorForNewWorkflow = useCallback((
    message: string,
    { updateRoute = true }: ResetWorkflowOptions = {},
  ) => {
    loadRequestRef.current += 1;
    onBusyChange(false);
    onApplyDocument({
      baseline: "clean",
      message,
      selectedNodeId: null,
      selectedWorkflowId: "",
      workflow: createEmptyWorkflow(),
    });
    if (updateRoute) {
      navigate({ kind: "new" });
    }
  }, [navigate, onApplyDocument, onBusyChange]);

  const startNewWorkflow = useCallback(() => {
    if (!confirmDiscardUnsavedChanges()) {
      return;
    }
    resetEditorForNewWorkflow("已新建工作流。");
  }, [confirmDiscardUnsavedChanges, resetEditorForNewWorkflow]);

  const applyTemplate = useCallback((templateId: string) => {
    if (!confirmDiscardUnsavedChanges()) {
      return;
    }

    try {
      const nextWorkflow = normalizeWorkflowDocument(createWorkflowFromTemplate(templateId));
      loadRequestRef.current += 1;
      onBusyChange(false);
      onApplyDocument({
        baseline: "dirty",
        message: `已应用模板：${nextWorkflow.name}。`,
        selectedNodeId: selectTemplateNode(templateId),
        selectedWorkflowId: "",
        workflow: nextWorkflow,
      });
      navigate({ kind: "new" });
    } catch (error) {
      onMessage(`模板应用失败：${formatApiError(error)}`);
    }
  }, [
    confirmDiscardUnsavedChanges,
    createWorkflowFromTemplate,
    navigate,
    onApplyDocument,
    onBusyChange,
    onMessage,
    selectTemplateNode,
  ]);

  const loadWorkflow = useCallback(async (
    workflowId: string,
    {
      confirmDiscard = true,
      nodeId,
      updateRoute = true,
    }: LoadWorkflowOptions = {},
  ): Promise<WorkflowRoute | null> => {
    if (!workflowId) {
      return null;
    }
    if (confirmDiscard && !confirmDiscardUnsavedChanges()) {
      return null;
    }

    const requestId = ++loadRequestRef.current;
    onBusyChange(true);
    try {
      const loaded = await client.getWorkflow(workflowId);
      if (!mountedRef.current || loadRequestRef.current !== requestId) {
        return null;
      }
      const normalizedLoaded = normalizeWorkflowDocument(loaded);
      const selectedRouteNodeId = nodeId && normalizedLoaded.nodes.some((node) => node.id === nodeId)
        ? nodeId
        : undefined;
      onApplyDocument({
        baseline: "clean",
        message: `已加载 ${loaded.name} v${loaded.version}。`,
        selectedNodeId: selectedRouteNodeId ?? null,
        selectedWorkflowId: loaded.id,
        workflow: normalizedLoaded,
      });
      const acceptedRoute: WorkflowRoute = {
        kind: "workflow",
        workflowId: loaded.id,
        ...(selectedRouteNodeId ? { nodeId: selectedRouteNodeId } : {}),
      };
      if (updateRoute) {
        navigate(acceptedRoute);
      }
      return acceptedRoute;
    } catch (error) {
      if (mountedRef.current && loadRequestRef.current === requestId) {
        onMessage(`工作流加载失败：${formatApiError(error)}`);
      }
      return null;
    } finally {
      if (mountedRef.current && loadRequestRef.current === requestId) {
        onBusyChange(false);
      }
    }
  }, [
    client,
    confirmDiscardUnsavedChanges,
    navigate,
    onApplyDocument,
    onBusyChange,
    onMessage,
  ]);

  const deleteWorkflow = useCallback(async (workflowId: string) => {
    if (!workflowId || isBusy) {
      return;
    }

    const deletingCurrentWorkflow = workflowId === selectedWorkflowId;
    onBusyChange(true);
    try {
      await client.deleteWorkflow(workflowId);
      await refreshWorkflowCatalog();
      if (!mountedRef.current) {
        return;
      }
      if (deletingCurrentWorkflow) {
        resetEditorForNewWorkflow("已删除当前工作流，已新建空白工作流。");
      } else {
        onMessage("已删除工作流。");
      }
    } catch (error) {
      if (mountedRef.current) {
        onMessage(`删除工作流失败：${formatApiError(error)}`);
      }
    } finally {
      if (mountedRef.current) {
        onBusyChange(false);
      }
    }
  }, [
    client,
    isBusy,
    onBusyChange,
    onMessage,
    refreshWorkflowCatalog,
    resetEditorForNewWorkflow,
    selectedWorkflowId,
  ]);

  const handleRouteRequest = useCallback(async (
    route: WorkflowRoute,
    source: WorkflowRouteRequestSource,
  ): Promise<WorkflowRoute | null> => {
    if (source === "popstate" && (isBusy || isCancelling || hasActiveOperation())) {
      onMessage("当前操作尚未完成，暂时不能离开这个工作流。");
      return null;
    }
    if (route.kind === "new") {
      if (source === "initial") {
        return route;
      }
      if (!confirmDiscardUnsavedChanges()) {
        return null;
      }
      resetEditorForNewWorkflow("已打开新工作流。", { updateRoute: false });
      return route;
    }
    if (route.kind === "execution") {
      const loadedRoute = await loadWorkflow(route.workflowId, {
        confirmDiscard: source !== "initial",
        updateRoute: false,
      });
      if (!loadedRoute) {
        return null;
      }
      return openHistoricalRun(route.executionId, {
        expectedWorkflowId: route.workflowId,
        nodeId: route.nodeId,
        updateRoute: false,
      });
    }
    return loadWorkflow(route.workflowId, {
      confirmDiscard: source !== "initial",
      nodeId: route.nodeId,
      updateRoute: false,
    });
  }, [
    confirmDiscardUnsavedChanges,
    hasActiveOperation,
    isBusy,
    isCancelling,
    loadWorkflow,
    onMessage,
    openHistoricalRun,
    resetEditorForNewWorkflow,
  ]);

  return {
    applyTemplate,
    confirmDiscardUnsavedChanges,
    deleteWorkflow,
    handleRouteRequest,
    loadWorkflow,
    resetEditorForNewWorkflow,
    startNewWorkflow,
  };
}
