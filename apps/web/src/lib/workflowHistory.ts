import type { EditScope } from "./workflow";
import type { WorkflowDocument } from "../types";

const MAX_WORKFLOW_HISTORY_ENTRIES = 80;

export type WorkflowHistoryEntry = {
  workflow: WorkflowDocument;
  editScope: EditScope;
  selectedNodeId: string | null;
};

export type WorkflowHistory = {
  past: WorkflowHistoryEntry[];
  future: WorkflowHistoryEntry[];
};

export type WorkflowHistoryTransition = {
  history: WorkflowHistory;
  entry: WorkflowHistoryEntry;
};

export function createWorkflowHistory(): WorkflowHistory {
  return { past: [], future: [] };
}

export function recordWorkflowHistory(history: WorkflowHistory, entry: WorkflowHistoryEntry): WorkflowHistory {
  return {
    past: [...history.past, cloneEntry(entry)].slice(-MAX_WORKFLOW_HISTORY_ENTRIES),
    future: [],
  };
}

export function undoWorkflowHistory(
  history: WorkflowHistory,
  current: WorkflowHistoryEntry
): WorkflowHistoryTransition | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) {
    return null;
  }

  return {
    entry: cloneEntry(entry),
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, cloneEntry(current)].slice(-MAX_WORKFLOW_HISTORY_ENTRIES),
    },
  };
}

export function redoWorkflowHistory(
  history: WorkflowHistory,
  current: WorkflowHistoryEntry
): WorkflowHistoryTransition | null {
  const entry = history.future[history.future.length - 1];
  if (!entry) {
    return null;
  }

  return {
    entry: cloneEntry(entry),
    history: {
      past: [...history.past, cloneEntry(current)].slice(-MAX_WORKFLOW_HISTORY_ENTRIES),
      future: history.future.slice(0, -1),
    },
  };
}

function cloneEntry(entry: WorkflowHistoryEntry): WorkflowHistoryEntry {
  return {
    workflow: JSON.parse(JSON.stringify(entry.workflow)) as WorkflowDocument,
    editScope: entry.editScope ? entry.editScope.map((scope) => ({ ...scope })) : undefined,
    selectedNodeId: entry.selectedNodeId,
  };
}
