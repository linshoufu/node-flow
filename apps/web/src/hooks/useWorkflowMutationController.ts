import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { apiClient } from "../api/client";
import { normalizeWorkflowDocument } from "../lib/workflow";
import type { WorkflowDocument, WorkflowUpgradePreview } from "../types";

export type WorkflowMutationOperation =
  | "save"
  | "activation"
  | "restore"
  | "rollback"
  | "preview_upgrades"
  | "apply_upgrades";

export type WorkflowSaveMode = "auto" | "manual";

export type WorkflowMutationResult<T> =
  | { kind: "success"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "busy" }
  | { kind: "stale" };

export type WorkflowMutationClient = Pick<
  ApiClient,
  | "applyWorkflowUpgrades"
  | "previewWorkflowUpgrades"
  | "restoreWorkflowVersion"
  | "rollbackWorkflowVersion"
  | "saveWorkflow"
  | "setWorkflowActive"
>;

type UseWorkflowMutationControllerOptions = {
  client?: WorkflowMutationClient;
  documentId: string;
};

type ActiveMutation = {
  operation: WorkflowMutationOperation;
  documentId: string;
  token: number;
  saveMode?: WorkflowSaveMode;
};

export function useWorkflowMutationController({
  client = apiClient,
  documentId,
}: UseWorkflowMutationControllerOptions) {
  const [activeOperation, setActiveOperation] = useState<WorkflowMutationOperation | null>(null);
  const [activeSaveMode, setActiveSaveMode] = useState<WorkflowSaveMode | null>(null);
  const [upgradePreview, setUpgradePreview] = useState<WorkflowUpgradePreview | null>(null);
  const mountedRef = useRef(true);
  const documentIdRef = useRef(documentId);
  const activeMutationRef = useRef<ActiveMutation | null>(null);
  const operationTokenRef = useRef(0);
  documentIdRef.current = documentId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationTokenRef.current += 1;
      activeMutationRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    operationTokenRef.current += 1;
    activeMutationRef.current = null;
    setActiveOperation(null);
    setActiveSaveMode(null);
    setUpgradePreview(null);
  }, [documentId]);

  const runOperation = useCallback(async <T,>(
    operation: WorkflowMutationOperation,
    targetDocumentId: string,
    request: () => Promise<T>,
    normalize: (value: T) => T = (value) => value,
    saveMode?: WorkflowSaveMode,
  ): Promise<WorkflowMutationResult<T>> => {
    if (activeMutationRef.current !== null) {
      return { kind: "busy" };
    }

    const token = ++operationTokenRef.current;
    const activeMutation = { operation, documentId: targetDocumentId, token, saveMode };
    activeMutationRef.current = activeMutation;
    setActiveOperation(operation);
    setActiveSaveMode(saveMode ?? null);

    try {
      const value = normalize(await request());
      if (
        !mountedRef.current
        || operationTokenRef.current !== token
        || documentIdRef.current !== targetDocumentId
      ) {
        return { kind: "stale" };
      }
      return { kind: "success", value };
    } catch (error) {
      if (
        !mountedRef.current
        || operationTokenRef.current !== token
        || documentIdRef.current !== targetDocumentId
      ) {
        return { kind: "stale" };
      }
      return { kind: "error", error };
    } finally {
      if (activeMutationRef.current?.token === token) {
        activeMutationRef.current = null;
        if (mountedRef.current) {
          setActiveOperation(null);
          setActiveSaveMode(null);
        }
      }
    }
  }, []);

  const saveWorkflow = useCallback((
    workflow: WorkflowDocument,
    expectedVersion?: number,
    mode: WorkflowSaveMode = "manual",
    ownerDocumentId: string = workflow.id,
  ) => runOperation(
    "save",
    ownerDocumentId,
    () => client.saveWorkflow(workflow, expectedVersion),
    normalizeWorkflowDocument,
    mode,
  ), [client, runOperation]);

  const updateActivation = useCallback((
    workflowId: string,
    active: boolean,
    expectedVersion?: number,
  ) => runOperation(
    "activation",
    workflowId,
    () => client.setWorkflowActive(workflowId, active, expectedVersion),
    normalizeWorkflowDocument,
  ), [client, runOperation]);

  const restoreVersion = useCallback((
    workflowId: string,
    version: number,
    expectedVersion?: number,
  ) => runOperation(
    "restore",
    workflowId,
    () => client.restoreWorkflowVersion(workflowId, version, expectedVersion),
    normalizeWorkflowDocument,
  ), [client, runOperation]);

  const rollbackVersion = useCallback((
    workflowId: string,
    version: number,
    expectedVersion?: number,
  ) => runOperation(
    "rollback",
    workflowId,
    () => client.rollbackWorkflowVersion(workflowId, version, expectedVersion),
    normalizeWorkflowDocument,
  ), [client, runOperation]);

  const previewNodeUpgrades = useCallback(async (workflowId: string) => {
    const result = await runOperation(
      "preview_upgrades",
      workflowId,
      () => client.previewWorkflowUpgrades(workflowId),
      (preview) => ({
        ...preview,
        workflow: normalizeWorkflowDocument(preview.workflow),
      }),
    );
    if (result.kind === "success") {
      setUpgradePreview(result.value.upgrades.length > 0 ? result.value : null);
    }
    return result;
  }, [client, runOperation]);

  const applyNodeUpgrades = useCallback(async (workflowId: string, expectedVersion?: number) => {
    const result = await runOperation(
      "apply_upgrades",
      workflowId,
      () => client.applyWorkflowUpgrades(workflowId, expectedVersion),
      normalizeWorkflowDocument,
    );
    if (result.kind === "success") {
      setUpgradePreview(null);
    }
    return result;
  }, [client, runOperation]);

  const dismissUpgradePreview = useCallback(() => {
    setUpgradePreview(null);
  }, []);

  return {
    activeOperation,
    activeSaveMode,
    applyNodeUpgrades,
    dismissUpgradePreview,
    isMutating: activeOperation !== null,
    previewNodeUpgrades,
    restoreVersion,
    rollbackVersion,
    saveWorkflow,
    updateActivation,
    upgradePreview,
  };
}
