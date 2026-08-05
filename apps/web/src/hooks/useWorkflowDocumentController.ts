import { useCallback, useMemo, useRef, useState } from "react";
import {
  buildWorkflowSaveState,
  serializeWorkflowForSaveState,
  type WorkflowSaveState,
} from "../lib/saveState";
import {
  createWorkflowHistory,
  recordWorkflowHistory,
  redoWorkflowHistory,
  undoWorkflowHistory,
  type WorkflowHistory,
  type WorkflowHistoryEntry,
} from "../lib/workflowHistory";
import type { WorkflowDocument } from "../types";

export type WorkflowHistoryContext = Pick<WorkflowHistoryEntry, "editScope" | "selectedNodeId">;
export type WorkflowBaseline = "clean" | "dirty";

type ReplaceWorkflowOptions = {
  baseline: WorkflowBaseline;
  resetHistory?: boolean;
};

type UseWorkflowDocumentControllerOptions = {
  initialWorkflow: WorkflowDocument;
  selectedWorkflowId: string;
};

export type WorkflowDocumentController = {
  acceptSavedWorkflow: (
    workflow: WorkflowDocument,
    options?: { requestRevision?: number },
  ) => { preservedNewerChanges: boolean };
  canRedo: boolean;
  canUndo: boolean;
  commitChange: (
    updater: (current: WorkflowDocument) => WorkflowDocument,
    context: WorkflowHistoryContext,
  ) => boolean;
  history: WorkflowHistory;
  redo: (context: WorkflowHistoryContext) => WorkflowHistoryEntry | null;
  revision: number;
  replaceWorkflow: (workflow: WorkflowDocument, options: ReplaceWorkflowOptions) => void;
  resetHistory: () => void;
  saveState: WorkflowSaveState;
  setHistoryGroupActive: (active: boolean) => void;
  undo: (context: WorkflowHistoryContext) => WorkflowHistoryEntry | null;
  workflow: WorkflowDocument;
};

export function useWorkflowDocumentController({
  initialWorkflow,
  selectedWorkflowId,
}: UseWorkflowDocumentControllerOptions): WorkflowDocumentController {
  const [workflow, setWorkflow] = useState(initialWorkflow);
  const [history, setHistory] = useState<WorkflowHistory>(() => createWorkflowHistory());
  const [revision, setRevision] = useState(0);
  const [cleanSnapshot, setCleanSnapshot] = useState<string | null>(() =>
    serializeWorkflowForSaveState(initialWorkflow)
  );
  const workflowRef = useRef(workflow);
  const historyRef = useRef(history);
  const revisionRef = useRef(revision);
  const historyGroupActiveRef = useRef(false);
  const historyGroupRecordedRef = useRef(false);

  const applyHistory = useCallback((nextHistory: WorkflowHistory) => {
    historyRef.current = nextHistory;
    setHistory(nextHistory);
  }, []);

  const resetHistory = useCallback(() => {
    historyGroupActiveRef.current = false;
    historyGroupRecordedRef.current = false;
    applyHistory(createWorkflowHistory());
  }, [applyHistory]);

  const applyWorkflow = useCallback((nextWorkflow: WorkflowDocument, trackRevision = true) => {
    workflowRef.current = nextWorkflow;
    setWorkflow(nextWorkflow);
    if (trackRevision) {
      revisionRef.current += 1;
      setRevision(revisionRef.current);
    }
  }, []);

  const replaceWorkflow = useCallback((
    nextWorkflow: WorkflowDocument,
    { baseline, resetHistory: shouldResetHistory = true }: ReplaceWorkflowOptions,
  ) => {
    applyWorkflow(nextWorkflow);
    setCleanSnapshot(
      baseline === "clean" ? serializeWorkflowForSaveState(nextWorkflow) : null
    );
    if (shouldResetHistory) {
      resetHistory();
    }
  }, [applyWorkflow, resetHistory]);

  const acceptSavedWorkflow = useCallback((
    nextWorkflow: WorkflowDocument,
    options: { requestRevision?: number } = {},
  ) => {
    const preservedNewerChanges =
      options.requestRevision !== undefined && options.requestRevision !== revisionRef.current;
    if (preservedNewerChanges) {
      const rebase = (document: WorkflowDocument): WorkflowDocument => ({
        ...document,
        active: nextWorkflow.active,
        id: nextWorkflow.id,
        version: nextWorkflow.version,
      });
      applyWorkflow(rebase(workflowRef.current), false);
      applyHistory({
        past: historyRef.current.past.map((entry) => ({
          ...entry,
          workflow: rebase(entry.workflow),
        })),
        future: historyRef.current.future.map((entry) => ({
          ...entry,
          workflow: rebase(entry.workflow),
        })),
      });
    } else {
      applyWorkflow(nextWorkflow, false);
    }
    setCleanSnapshot(serializeWorkflowForSaveState(nextWorkflow));
    return { preservedNewerChanges };
  }, [applyHistory, applyWorkflow]);

  const commitChange = useCallback((
    updater: (current: WorkflowDocument) => WorkflowDocument,
    context: WorkflowHistoryContext,
  ): boolean => {
    const current = workflowRef.current;
    const next = updater(current);
    if (next === current) {
      return false;
    }

    const shouldRecordHistory =
      !historyGroupActiveRef.current || !historyGroupRecordedRef.current;
    if (shouldRecordHistory) {
      applyHistory(recordWorkflowHistory(historyRef.current, {
        workflow: current,
        ...context,
      }));
      historyGroupRecordedRef.current = historyGroupActiveRef.current;
    }
    applyWorkflow(next);
    return true;
  }, [applyHistory, applyWorkflow]);

  const setHistoryGroupActive = useCallback((active: boolean) => {
    historyGroupActiveRef.current = active;
    if (active) {
      historyGroupRecordedRef.current = false;
    }
  }, []);

  const undo = useCallback((context: WorkflowHistoryContext): WorkflowHistoryEntry | null => {
    const transition = undoWorkflowHistory(historyRef.current, {
      workflow: workflowRef.current,
      ...context,
    });
    if (!transition) {
      return null;
    }
    applyHistory(transition.history);
    applyWorkflow(transition.entry.workflow);
    return transition.entry;
  }, [applyHistory, applyWorkflow]);

  const redo = useCallback((context: WorkflowHistoryContext): WorkflowHistoryEntry | null => {
    const transition = redoWorkflowHistory(historyRef.current, {
      workflow: workflowRef.current,
      ...context,
    });
    if (!transition) {
      return null;
    }
    applyHistory(transition.history);
    applyWorkflow(transition.entry.workflow);
    return transition.entry;
  }, [applyHistory, applyWorkflow]);

  const saveState = useMemo(() => buildWorkflowSaveState({
    workflow,
    cleanWorkflowSnapshot: cleanSnapshot,
    selectedWorkflowId,
  }), [cleanSnapshot, selectedWorkflowId, workflow]);

  return {
    acceptSavedWorkflow,
    canRedo: history.future.length > 0,
    canUndo: history.past.length > 0,
    commitChange,
    history,
    redo,
    replaceWorkflow,
    revision,
    resetHistory,
    saveState,
    setHistoryGroupActive,
    undo,
    workflow,
  };
}
