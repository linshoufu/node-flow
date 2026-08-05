import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { apiClient } from "../api/client";
import { formatApiError } from "../lib/apiError";
import type {
  WorkflowDocument,
  WorkflowPublicationStatus,
  WorkflowSummary,
} from "../types";

export type WorkflowCatalogClient = Pick<
  ApiClient,
  "getWorkflowPublication" | "listWorkflows"
>;

type UseWorkflowCatalogControllerOptions = {
  client?: WorkflowCatalogClient;
};

export function useWorkflowCatalogController({
  client = apiClient,
}: UseWorkflowCatalogControllerOptions = {}) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [publication, setPublication] = useState<WorkflowPublicationStatus | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const mountedRef = useRef(true);
  const selectedWorkflowIdRef = useRef("");
  const catalogRequestRef = useRef(0);
  const publicationRequestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      catalogRequestRef.current += 1;
      publicationRequestRef.current += 1;
    };
  }, []);

  const isSelectedWorkflowCurrent = useCallback((workflowId: string) =>
    mountedRef.current && selectedWorkflowIdRef.current === workflowId, []);

  const refreshCatalog = useCallback(async (): Promise<WorkflowSummary[] | null> => {
    const requestId = ++catalogRequestRef.current;
    setCatalogError(null);
    setIsCatalogLoading(true);
    try {
      const nextWorkflows = await client.listWorkflows();
      if (!mountedRef.current || catalogRequestRef.current !== requestId) {
        return null;
      }
      setWorkflows(nextWorkflows);
      return nextWorkflows;
    } catch (error) {
      if (mountedRef.current && catalogRequestRef.current === requestId) {
        setCatalogError(`工作流列表加载失败：${formatApiError(error)}`);
      }
      return null;
    } finally {
      if (mountedRef.current && catalogRequestRef.current === requestId) {
        setIsCatalogLoading(false);
      }
    }
  }, [client]);

  useEffect(() => {
    void refreshCatalog();
    return () => {
      catalogRequestRef.current += 1;
    };
  }, [refreshCatalog]);

  const refreshPublication = useCallback(async (
    workflowId = selectedWorkflowIdRef.current,
  ): Promise<WorkflowPublicationStatus | null> => {
    if (!workflowId) {
      setPublication(null);
      return null;
    }

    const requestId = ++publicationRequestRef.current;
    try {
      const nextPublication = await client.getWorkflowPublication(workflowId);
      if (
        !mountedRef.current
        || publicationRequestRef.current !== requestId
        || selectedWorkflowIdRef.current !== workflowId
      ) {
        return null;
      }
      setPublication(nextPublication);
      return nextPublication;
    } catch {
      if (
        mountedRef.current
        && publicationRequestRef.current === requestId
        && selectedWorkflowIdRef.current === workflowId
      ) {
        setPublication(null);
      }
      return null;
    }
  }, [client]);

  const selectWorkflow = useCallback((workflowId: string) => {
    const selectionChanged = selectedWorkflowIdRef.current !== workflowId;
    selectedWorkflowIdRef.current = workflowId;
    publicationRequestRef.current += 1;
    setSelectedWorkflowId(workflowId);
    if (selectionChanged) {
      setPublication(null);
    }
    return workflowId ? refreshPublication(workflowId) : Promise.resolve(null);
  }, [refreshPublication]);

  const upsertWorkflowSummary = useCallback((saved: WorkflowDocument) => {
    setWorkflows((current) => {
      const existingIndex = current.findIndex((item) => item.id === saved.id);
      const existing = existingIndex === -1 ? undefined : current[existingIndex];
      const summary: WorkflowSummary = {
        id: saved.id,
        name: saved.name,
        active: saved.active ?? existing?.active ?? true,
        description: saved.description ?? "",
        tags: saved.tags ?? [],
        version: saved.version,
        updated_at: existing?.updated_at,
        node_count: saved.nodes.length,
        last_run_status: existing?.last_run_status,
      };
      if (existingIndex === -1) {
        return [...current, summary];
      }
      return current.map((item, index) => (index === existingIndex ? summary : item));
    });
  }, []);

  const removeWorkflowSummary = useCallback((workflowId: string) => {
    setWorkflows((current) => current.filter((workflow) => workflow.id !== workflowId));
  }, []);

  return {
    catalogError,
    isCatalogLoading,
    isSelectedWorkflowCurrent,
    publication,
    refreshCatalog,
    refreshPublication,
    removeWorkflowSummary,
    selectedWorkflowId,
    selectWorkflow,
    upsertWorkflowSummary,
    workflows,
  };
}
