import { useCallback, useEffect, useState } from "react";
import { isWorkflowVersionConflict, parseApiError } from "../lib/apiError";

export type WorkflowConflictAction =
  | "activation"
  | "apply_upgrades"
  | "restore"
  | "rollback"
  | "save";

export type WorkflowConflict = {
  action: WorkflowConflictAction;
  currentVersion: number | null;
  expectedVersion: number | null;
};

type UseWorkflowConflictControllerOptions = {
  documentId: string;
  onMessage: (message: string) => void;
};

export function useWorkflowConflictController({
  documentId,
  onMessage,
}: UseWorkflowConflictControllerOptions) {
  const [conflict, setConflict] = useState<WorkflowConflict | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setConflict(null);
    setIsOpen(false);
  }, [documentId]);

  const openWorkflowConflict = useCallback((
    action: WorkflowConflictAction,
    error: unknown,
  ): boolean => {
    if (!isWorkflowVersionConflict(error)) {
      return false;
    }

    const parsed = parseApiError(error);
    setConflict({
      action,
      currentVersion: parsed.currentVersion,
      expectedVersion: parsed.expectedVersion,
    });
    setIsOpen(true);
    onMessage("检测到工作流版本冲突，当前页面修改仍然保留。");
    return true;
  }, [onMessage]);

  const closeWorkflowConflict = useCallback(() => {
    setIsOpen(false);
  }, []);

  const reopenWorkflowConflict = useCallback(() => {
    setIsOpen((current) => current || conflict !== null);
  }, [conflict]);

  const clearWorkflowConflict = useCallback(() => {
    setConflict(null);
    setIsOpen(false);
  }, []);

  return {
    clearWorkflowConflict,
    closeWorkflowConflict,
    conflict,
    isOpen,
    openWorkflowConflict,
    reopenWorkflowConflict,
  };
}
