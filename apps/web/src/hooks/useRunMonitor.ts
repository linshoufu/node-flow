import { useEffect } from "react";
import { useRunsStore } from "@/store/runs";
import type { RunRecord } from "@/types";

export function useRunMonitor(workflowId: string, viewingHistory: boolean) {
  const pending = useRunsStore((state) => state.activeRun?.status === "queued" || state.activeRun?.status === "running" ||
    state.runs.some((run) => run.status === "queued" || run.status === "running"));
  useEffect(() => {
    useRunsStore.getState().setWorkflow(workflowId);
    return () => useRunsStore.getState().setWorkflow("");
  }, [workflowId]);
  useEffect(() => {
    const created = (event: Event) => {
      const run = (event as CustomEvent<RunRecord>).detail;
      if (run) useRunsStore.getState().acceptRun(run);
    };
    window.addEventListener("nodeflow:run-created", created);
    return () => window.removeEventListener("nodeflow:run-created", created);
  }, []);
  useEffect(() => {
    if (!workflowId || (!pending && !viewingHistory)) return;
    let busy = false;
    const timer = window.setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const state = useRunsStore.getState();
        await Promise.all([state.refresh(), state.refreshDetail()]);
      } finally { busy = false; }
    }, 1800);
    return () => window.clearInterval(timer);
  }, [workflowId, pending, viewingHistory]);
}
