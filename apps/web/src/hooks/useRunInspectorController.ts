import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { apiClient } from "../api/client";
import { formatApiError } from "../lib/apiError";
import type { RunEvent, RunRecord, WorkflowDocument } from "../types";

export type RunInspectorClient = Pick<
  ApiClient,
  "getRun" | "getRunEvents" | "getWorkflowVersion"
>;

export type HistoricalRunLoadResult =
  | {
      kind: "success";
      run: RunRecord;
      events: RunEvent[];
      executedWorkflow: WorkflowDocument | null;
      selectedNodeId?: string;
    }
  | { kind: "mismatch" }
  | { kind: "error"; error: unknown }
  | { kind: "stale" };

export type ComparisonRunLoadResult =
  | { kind: "success" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "stale" };

type UseRunInspectorControllerOptions = {
  client?: RunInspectorClient;
  currentWorkflow: WorkflowDocument;
  recentRuns: RunRecord[];
};

export function useRunInspectorController({
  client = apiClient,
  currentWorkflow,
  recentRuns,
}: UseRunInspectorControllerOptions) {
  const [historicalRunWorkflow, setHistoricalRunWorkflow] = useState<WorkflowDocument | null>(null);
  const [isHistoricalRunLoading, setIsHistoricalRunLoading] = useState(false);
  const [comparisonRun, setComparisonRun] = useState<RunRecord | null>(null);
  const [comparisonEvents, setComparisonEvents] = useState<RunEvent[]>([]);
  const [isComparisonLoading, setIsComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const historicalRequestTokenRef = useRef(0);
  const comparisonRequestTokenRef = useRef(0);
  const currentWorkflowRef = useRef(currentWorkflow);
  const recentRunsRef = useRef(recentRuns);
  currentWorkflowRef.current = currentWorkflow;
  recentRunsRef.current = recentRuns;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      historicalRequestTokenRef.current += 1;
      comparisonRequestTokenRef.current += 1;
    };
  }, []);

  const resetRunComparison = useCallback(() => {
    comparisonRequestTokenRef.current += 1;
    if (!mountedRef.current) {
      return;
    }
    setComparisonRun(null);
    setComparisonEvents([]);
    setIsComparisonLoading(false);
    setComparisonError(null);
  }, []);

  const clearHistoricalRunWorkflow = useCallback(() => {
    historicalRequestTokenRef.current += 1;
    if (!mountedRef.current) {
      return;
    }
    setHistoricalRunWorkflow(null);
    setIsHistoricalRunLoading(false);
  }, []);

  const resetRunInspector = useCallback(() => {
    clearHistoricalRunWorkflow();
    resetRunComparison();
  }, [clearHistoricalRunWorkflow, resetRunComparison]);

  const loadHistoricalRun = useCallback(async (
    runId: string,
    {
      expectedWorkflowId,
      nodeId,
    }: {
      expectedWorkflowId?: string;
      nodeId?: string;
    } = {},
  ): Promise<HistoricalRunLoadResult> => {
    const requestToken = ++historicalRequestTokenRef.current;
    resetRunComparison();
    setHistoricalRunWorkflow(null);
    setIsHistoricalRunLoading(true);

    try {
      const run = recentRunsRef.current.find((item) => item.id === runId)
        ?? await client.getRun(runId);
      if (!isHistoricalRequestCurrent(requestToken)) {
        return { kind: "stale" };
      }
      if (expectedWorkflowId && run.workflow_id !== expectedWorkflowId) {
        return { kind: "mismatch" };
      }

      const workflowAtRequest = currentWorkflowRef.current;
      const [events, workflowAtRunVersion] = await Promise.all([
        client.getRunEvents(run.id),
        run.workflow_id === workflowAtRequest.id && run.workflow_version === workflowAtRequest.version
          ? Promise.resolve(null)
          : client.getWorkflowVersion(run.workflow_id, run.workflow_version),
      ]);
      if (!isHistoricalRequestCurrent(requestToken)) {
        return { kind: "stale" };
      }

      const currentWorkflowStillMatches =
        run.workflow_id === currentWorkflowRef.current.id
        && run.workflow_version === currentWorkflowRef.current.version;
      const executedWorkflow = workflowAtRunVersion
        ?? (currentWorkflowStillMatches
          ? null
          : await client.getWorkflowVersion(run.workflow_id, run.workflow_version));
      if (!isHistoricalRequestCurrent(requestToken)) {
        return { kind: "stale" };
      }

      const displayWorkflow = executedWorkflow
        ?? (run.workflow_id === currentWorkflowRef.current.id ? currentWorkflowRef.current : null);
      const selectedNodeId = nodeId && displayWorkflow?.nodes.some((node) => node.id === nodeId)
        ? nodeId
        : undefined;
      setHistoricalRunWorkflow(executedWorkflow);
      return {
        kind: "success",
        run,
        events,
        executedWorkflow,
        ...(selectedNodeId ? { selectedNodeId } : {}),
      };
    } catch (error: unknown) {
      return isHistoricalRequestCurrent(requestToken)
        ? { kind: "error", error }
        : { kind: "stale" };
    } finally {
      if (isHistoricalRequestCurrent(requestToken)) {
        setIsHistoricalRunLoading(false);
      }
    }
  }, [client, resetRunComparison]);

  const loadComparisonRun = useCallback(async (
    runId: string,
  ): Promise<ComparisonRunLoadResult> => {
    const candidate = recentRunsRef.current.find((item) => item.id === runId);
    if (!candidate) {
      return { kind: "missing" };
    }

    const requestToken = ++comparisonRequestTokenRef.current;
    setComparisonRun(candidate);
    setComparisonEvents([]);
    setComparisonError(null);
    setIsComparisonLoading(true);

    try {
      const events = await client.getRunEvents(candidate.id);
      if (!isComparisonRequestCurrent(requestToken)) {
        return { kind: "stale" };
      }
      setComparisonEvents(events);
      return { kind: "success" };
    } catch (error: unknown) {
      if (!isComparisonRequestCurrent(requestToken)) {
        return { kind: "stale" };
      }
      setComparisonError(formatApiError(error));
      return { kind: "error" };
    } finally {
      if (isComparisonRequestCurrent(requestToken)) {
        setIsComparisonLoading(false);
      }
    }
  }, [client]);

  function isHistoricalRequestCurrent(token: number): boolean {
    return mountedRef.current && historicalRequestTokenRef.current === token;
  }

  function isComparisonRequestCurrent(token: number): boolean {
    return mountedRef.current && comparisonRequestTokenRef.current === token;
  }

  return {
    clearHistoricalRunWorkflow,
    comparisonError,
    comparisonEvents,
    comparisonRun,
    historicalRunWorkflow,
    isComparisonLoading,
    isHistoricalRunLoading,
    loadComparisonRun,
    loadHistoricalRun,
    resetRunComparison,
    resetRunInspector,
  };
}
