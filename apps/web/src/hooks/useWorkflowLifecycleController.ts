import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { apiClient } from "../api/client";
import { formatApiError } from "../lib/apiError";
import { normalizeWorkflowDocument } from "../lib/workflow";
import {
  buildWorkflowVersionDiff,
  type WorkflowVersionDiff,
} from "../lib/workflowVersionDiff";
import type {
  WorkflowDocument,
  WorkflowTriggerStatus,
  WorkflowVersionSummary,
} from "../types";

export type WorkflowLifecycleClient = Pick<
  ApiClient,
  "getWorkflowVersion" | "listWorkflowTriggers" | "listWorkflowVersions"
>;

type UseWorkflowLifecycleControllerOptions = {
  client?: WorkflowLifecycleClient;
  currentWorkflow: WorkflowDocument;
  workflowId: string;
};

export function useWorkflowLifecycleController({
  client = apiClient,
  currentWorkflow,
  workflowId,
}: UseWorkflowLifecycleControllerOptions) {
  const [versions, setVersions] = useState<WorkflowVersionSummary[]>([]);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [isVersionsLoading, setIsVersionsLoading] = useState(false);
  const [isVersionsOpen, setIsVersionsOpen] = useState(false);
  const [triggers, setTriggers] = useState<WorkflowTriggerStatus[]>([]);
  const [triggersError, setTriggersError] = useState<string | null>(null);
  const [isTriggersLoading, setIsTriggersLoading] = useState(false);
  const [isTriggersOpen, setIsTriggersOpen] = useState(false);
  const [versionDiff, setVersionDiff] = useState<WorkflowVersionDiff | null>(null);
  const [versionDiffError, setVersionDiffError] = useState<string | null>(null);
  const [isVersionDiffLoading, setIsVersionDiffLoading] = useState(false);
  const [rollbackTargetVersion, setRollbackTargetVersion] = useState<number | null>(null);
  const mountedRef = useRef(true);
  const workflowIdRef = useRef(workflowId);
  const versionsRequestRef = useRef(0);
  const triggersRequestRef = useRef(0);
  const diffRequestRef = useRef(0);
  workflowIdRef.current = workflowId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      versionsRequestRef.current += 1;
      triggersRequestRef.current += 1;
      diffRequestRef.current += 1;
    };
  }, []);

  const clearVersionDiff = useCallback(() => {
    diffRequestRef.current += 1;
    setVersionDiff(null);
    setVersionDiffError(null);
    setIsVersionDiffLoading(false);
  }, []);

  useEffect(() => {
    versionsRequestRef.current += 1;
    triggersRequestRef.current += 1;
    diffRequestRef.current += 1;
    setVersions([]);
    setVersionsError(null);
    setIsVersionsLoading(false);
    setIsVersionsOpen(false);
    setTriggers([]);
    setTriggersError(null);
    setIsTriggersLoading(false);
    setIsTriggersOpen(false);
    setVersionDiff(null);
    setVersionDiffError(null);
    setIsVersionDiffLoading(false);
    setRollbackTargetVersion(null);
  }, [workflowId]);

  const refreshVersions = useCallback(async (): Promise<WorkflowVersionSummary[] | null> => {
    const targetWorkflowId = workflowIdRef.current;
    if (!targetWorkflowId) {
      return null;
    }
    const requestId = ++versionsRequestRef.current;
    setVersionsError(null);
    setIsVersionsLoading(true);
    try {
      const nextVersions = await client.listWorkflowVersions(targetWorkflowId);
      if (
        !mountedRef.current
        || workflowIdRef.current !== targetWorkflowId
        || versionsRequestRef.current !== requestId
      ) {
        return null;
      }
      setVersions(nextVersions);
      return nextVersions;
    } catch (error) {
      if (
        mountedRef.current
        && workflowIdRef.current === targetWorkflowId
        && versionsRequestRef.current === requestId
      ) {
        setVersionsError(`版本历史加载失败：${formatApiError(error)}`);
      }
      return null;
    } finally {
      if (
        mountedRef.current
        && workflowIdRef.current === targetWorkflowId
        && versionsRequestRef.current === requestId
      ) {
        setIsVersionsLoading(false);
      }
    }
  }, [client]);

  const toggleVersions = useCallback(() => {
    setIsVersionsOpen((current) => {
      if (!current) {
        void refreshVersions();
      }
      return !current;
    });
  }, [refreshVersions]);

  const refreshTriggers = useCallback(async (): Promise<WorkflowTriggerStatus[] | null> => {
    const targetWorkflowId = workflowIdRef.current;
    if (!targetWorkflowId) {
      return null;
    }
    const requestId = ++triggersRequestRef.current;
    setTriggersError(null);
    setIsTriggersLoading(true);
    try {
      const nextTriggers = await client.listWorkflowTriggers(targetWorkflowId);
      if (
        !mountedRef.current
        || workflowIdRef.current !== targetWorkflowId
        || triggersRequestRef.current !== requestId
      ) {
        return null;
      }
      setTriggers(nextTriggers);
      return nextTriggers;
    } catch (error) {
      if (
        mountedRef.current
        && workflowIdRef.current === targetWorkflowId
        && triggersRequestRef.current === requestId
      ) {
        setTriggersError(`触发器状态加载失败：${formatApiError(error)}`);
      }
      return null;
    } finally {
      if (
        mountedRef.current
        && workflowIdRef.current === targetWorkflowId
        && triggersRequestRef.current === requestId
      ) {
        setIsTriggersLoading(false);
      }
    }
  }, [client]);

  const toggleTriggers = useCallback(() => {
    setIsTriggersOpen((current) => {
      if (!current) {
        void refreshTriggers();
      }
      return !current;
    });
  }, [refreshTriggers]);

  const compareVersion = useCallback(async (version: number): Promise<WorkflowVersionDiff | null> => {
    const targetWorkflowId = workflowIdRef.current;
    if (!targetWorkflowId) {
      return null;
    }
    const requestId = ++diffRequestRef.current;
    const currentWorkflowSnapshot = normalizeWorkflowDocument(currentWorkflow);
    setIsVersionDiffLoading(true);
    setVersionDiff(null);
    setVersionDiffError(null);
    try {
      const historicalVersion = normalizeWorkflowDocument(
        await client.getWorkflowVersion(targetWorkflowId, version)
      );
      if (
        !mountedRef.current
        || workflowIdRef.current !== targetWorkflowId
        || diffRequestRef.current !== requestId
      ) {
        return null;
      }
      const diff = buildWorkflowVersionDiff(historicalVersion, currentWorkflowSnapshot);
      setVersionDiff(diff);
      return diff;
    } catch (error) {
      if (
        mountedRef.current
        && workflowIdRef.current === targetWorkflowId
        && diffRequestRef.current === requestId
      ) {
        setVersionDiffError(`版本差异加载失败：${formatApiError(error)}`);
      }
      return null;
    } finally {
      if (
        mountedRef.current
        && workflowIdRef.current === targetWorkflowId
        && diffRequestRef.current === requestId
      ) {
        setIsVersionDiffLoading(false);
      }
    }
  }, [client, currentWorkflow]);

  return {
    clearVersionDiff,
    compareVersion,
    isTriggersLoading,
    isTriggersOpen,
    isVersionDiffLoading,
    isVersionsLoading,
    isVersionsOpen,
    refreshTriggers,
    refreshVersions,
    rollbackTargetVersion,
    setRollbackTargetVersion,
    toggleTriggers,
    toggleVersions,
    triggers,
    triggersError,
    versionDiff,
    versionDiffError,
    versions,
    versionsError,
  };
}
