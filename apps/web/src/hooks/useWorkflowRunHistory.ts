import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { apiClient } from "../api/client";
import { formatApiError } from "../lib/apiError";
import { onRunTerminal } from "../lib/runTerminalBus";
import { mergeWorkflowRunHistory } from "../lib/workflowManager";
import type { RunHistoryStatusFilter, RunRecord } from "../types";

export type WorkflowRunHistoryClient = Pick<ApiClient, "listWorkflowRuns">;

type UseWorkflowRunHistoryOptions = {
  client?: WorkflowRunHistoryClient;
  pageSize?: number;
  workflowId: string;
};

type RefreshRunHistoryOptions = {
  preserveExistingOnError?: boolean;
};

const DEFAULT_PAGE_SIZE = 5;

export function useWorkflowRunHistory({
  client = apiClient,
  pageSize = DEFAULT_PAGE_SIZE,
  workflowId,
}: UseWorkflowRunHistoryOptions) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<RunHistoryStatusFilter>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const runsRef = useRef<RunRecord[]>([]);
  const statusFilterRef = useRef<RunHistoryStatusFilter>("all");
  const workflowIdRef = useRef(workflowId);
  workflowIdRef.current = workflowId;

  const replaceRuns = useCallback((nextRuns: RunRecord[]) => {
    runsRef.current = nextRuns;
    setRuns(nextRuns);
  }, []);

  const loadPage = useCallback(async ({
    append = false,
    clearBeforeLoad = false,
    preserveExistingOnError = false,
    status = statusFilterRef.current,
    targetWorkflowId = workflowIdRef.current,
  }: {
    append?: boolean;
    clearBeforeLoad?: boolean;
    preserveExistingOnError?: boolean;
    status?: RunHistoryStatusFilter;
    targetWorkflowId?: string;
  } = {}) => {
    const requestId = ++requestIdRef.current;
    const canApply = () => mountedRef.current
      && requestIdRef.current === requestId
      && workflowIdRef.current === targetWorkflowId;

    if (!targetWorkflowId) {
      replaceRuns([]);
      setHasMore(false);
      setError(null);
      setIsLoading(false);
      return;
    }

    if (clearBeforeLoad) {
      replaceRuns([]);
    }
    if (!append) {
      setHasMore(false);
    }
    setError(null);
    setIsLoading(true);

    try {
      const offset = append ? runsRef.current.length : 0;
      const nextPage = await client.listWorkflowRuns(
        targetWorkflowId,
        pageSize,
        offset,
        status === "all" ? undefined : status,
      );
      if (!canApply()) {
        return;
      }
      replaceRuns(append ? mergeWorkflowRunHistory(runsRef.current, nextPage) : nextPage);
      setHasMore(nextPage.length === pageSize);
      setError(null);
    } catch (loadError) {
      if (!canApply()) {
        return;
      }
      if (!preserveExistingOnError) {
        replaceRuns([]);
        setHasMore(false);
      }
      setError(`运行历史加载失败：${formatApiError(loadError)}`);
    } finally {
      if (canApply()) {
        setIsLoading(false);
      }
    }
  }, [client, pageSize, replaceRuns]);

  useEffect(() => {
    statusFilterRef.current = "all";
    setStatusFilter("all");
    void loadPage({ clearBeforeLoad: true, status: "all", targetWorkflowId: workflowId });
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadPage, workflowId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    // 当前工作流的运行到达终态时（stream 终态事件或轮询终态检测）自动刷新历史，无需手动刷新
    return onRunTerminal((terminalRun) => {
      if (terminalRun.workflow_id === workflowIdRef.current) {
        void loadPage({ preserveExistingOnError: true });
      }
    });
  }, [loadPage]);

  const refresh = useCallback((options: RefreshRunHistoryOptions = {}) =>
    loadPage({ preserveExistingOnError: options.preserveExistingOnError }), [loadPage]);

  const retry = useCallback(() => {
    if (workflowIdRef.current) {
      void loadPage();
    }
  }, [loadPage]);

  const loadMore = useCallback(() => {
    if (!workflowIdRef.current || !hasMore || isLoading) {
      return;
    }
    void loadPage({ append: true, preserveExistingOnError: true });
  }, [hasMore, isLoading, loadPage]);

  const changeStatusFilter = useCallback((status: RunHistoryStatusFilter) => {
    if (!workflowIdRef.current || status === statusFilterRef.current) {
      return;
    }
    statusFilterRef.current = status;
    setStatusFilter(status);
    void loadPage({ clearBeforeLoad: true, status });
  }, [loadPage]);

  return {
    changeStatusFilter,
    error,
    hasMore,
    isLoading,
    loadMore,
    refresh,
    retry,
    runs,
    statusFilter,
  };
}
