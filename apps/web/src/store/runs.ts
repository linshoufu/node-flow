import { create } from "zustand";
import { apiClient } from "@/api/client";
import type { RunEvent, RunHistoryStatusFilter, RunRecord, WorkflowDocument } from "@/types";

export const RUN_PAGE_SIZE = 20;
type RunsState = {
  workflowId: string; runs: RunRecord[]; activeRun: RunRecord | null; events: RunEvent[];
  document: WorkflowDocument | null; status: RunHistoryStatusFilter; page: number; hasMore: boolean;
  loading: boolean; loadingDetail: boolean; error: string | null; detailError: string | null; documentError: string | null;
  setWorkflow: (id: string) => void; refresh: () => Promise<void>; selectRun: (run: RunRecord) => Promise<void>;
  refreshDetail: () => Promise<void>; setStatus: (status: RunHistoryStatusFilter) => void;
  setPage: (page: number) => void; acceptRun: (run: RunRecord) => void;
};
let listRequest = 0;
let detailRequest = 0;

export const useRunsStore = create<RunsState>((set, get) => {
  const clearDetail = { activeRun: null, events: [], document: null, documentError: null, detailError: null, loadingDetail: false };
  const loadDetail = async (run: RunRecord) => {
    const request = ++detailRequest;
    const workflowId = get().workflowId;
    set({ loadingDetail: true });
    try {
      const record = await apiClient.getRun(run.id);
      if (get().workflowId !== workflowId || get().activeRun?.id !== run.id || request !== detailRequest) return;
      const cached = get().document;
      const sameVersion = cached?.id === record.workflow_id && cached.version === record.workflow_version;
      // Fetch events after status so a terminal update includes the final node data.
      const [events, snapshot] = await Promise.all([
        apiClient.getRunEvents(run.id),
        sameVersion ? Promise.resolve({ document: cached, error: null }) :
          apiClient.getWorkflowVersion(record.workflow_id, record.workflow_version)
            .then((document) => ({ document, error: null }))
            .catch(() => ({ document: null, error: "无法加载运行时的工作流版本，仍可查看执行事件。" })),
      ]);
      if (get().workflowId !== workflowId || get().activeRun?.id !== run.id || request !== detailRequest) return;
      set((state) => ({ activeRun: record, runs: state.runs.map((item) => item.id === record.id ? record : item),
        events: events.filter((event) => event.run_id === run.id), document: snapshot.document,
        documentError: snapshot.error, detailError: null }));
    } catch {
      if (get().workflowId === workflowId && get().activeRun?.id === run.id && request === detailRequest)
        set({ detailError: "无法加载运行详情，请重试。" });
    } finally {
      if (get().workflowId === workflowId && get().activeRun?.id === run.id && request === detailRequest)
        set({ loadingDetail: false });
    }
  };
  return {
    workflowId: "", runs: [], ...clearDetail, status: "all", page: 0, hasMore: false, loading: false, error: null,
    setWorkflow: (workflowId) => {
      listRequest++; detailRequest++;
      set({ workflowId, runs: [], ...clearDetail, status: "all", page: 0, hasMore: false, loading: false, error: null });
      if (workflowId) void get().refresh();
    },
    refresh: async () => {
      const { workflowId, page, status } = get();
      if (!workflowId) return;
      const request = ++listRequest;
      set({ loading: true });
      try {
        const result = await apiClient.listWorkflowRuns(workflowId, RUN_PAGE_SIZE + 1, page * RUN_PAGE_SIZE, status === "all" ? undefined : status);
        if (get().workflowId !== workflowId || request !== listRequest) return;
        const runs = result.slice(0, RUN_PAGE_SIZE);
        const selected = get().activeRun;
        set({ runs, hasMore: result.length > RUN_PAGE_SIZE, error: null,
          ...(selected ? { activeRun: runs.find((run) => run.id === selected.id) ?? selected } : {}) });
        if (!selected && runs[0]) await get().selectRun(runs[0]);
      } catch {
        if (get().workflowId === workflowId && request === listRequest) set({ error: "无法加载运行记录，请重试。" });
      } finally {
        if (get().workflowId === workflowId && request === listRequest) set({ loading: false });
      }
    },
    selectRun: async (run) => {
      if (run.workflow_id !== get().workflowId) return;
      set({ ...clearDetail, activeRun: run, error: null });
      await loadDetail(run);
    },
    refreshDetail: async () => { const run = get().activeRun; if (run) await loadDetail(run); },
    setStatus: (status) => {
      detailRequest++;
      set({ status, page: 0, ...clearDetail });
      void get().refresh();
    },
    setPage: (page) => {
      detailRequest++;
      set({ page: Math.max(0, page), ...clearDetail });
      void get().refresh();
    },
    acceptRun: (run) => {
      if (run.workflow_id !== get().workflowId) return;
      listRequest++;
      set({ status: "all", page: 0, loading: false, runs: [run, ...get().runs.filter((item) => item.id !== run.id)].slice(0, RUN_PAGE_SIZE) });
      void get().selectRun(run);
    },
  };
});
