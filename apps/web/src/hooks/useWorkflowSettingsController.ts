import { useCallback, useEffect, useState } from "react";
import {
  workflowTimeoutSeconds,
  workflowVariables,
} from "../lib/workflow";
import {
  MAX_WORKFLOW_TIMEOUT_SECONDS,
  MIN_WORKFLOW_TIMEOUT_SECONDS,
} from "../lib/workflowSettings";
import { nextWorkflowVariableName } from "../lib/workflowVariables";
import type { WorkflowDocument, WorkflowSettings } from "../types";

type UseWorkflowSettingsControllerOptions = {
  commitWorkflowChange: (
    updater: (current: WorkflowDocument) => WorkflowDocument,
  ) => void;
  isEditorLocked: boolean;
  workflowId: string;
};

export function useWorkflowSettingsController({
  commitWorkflowChange,
  isEditorLocked,
  workflowId,
}: UseWorkflowSettingsControllerOptions) {
  const [workflowTagInput, setWorkflowTagInput] = useState("");

  useEffect(() => {
    setWorkflowTagInput("");
  }, [workflowId]);

  const updateWorkflowName = useCallback((name: string) => {
    if (isEditorLocked) {
      return;
    }
    commitWorkflowChange((current) => ({ ...current, name }));
  }, [commitWorkflowChange, isEditorLocked]);

  const updateWorkflowDescription = useCallback((description: string) => {
    if (isEditorLocked) {
      return;
    }
    commitWorkflowChange((current) => ({ ...current, description }));
  }, [commitWorkflowChange, isEditorLocked]);

  const addWorkflowTag = useCallback(() => {
    if (isEditorLocked) {
      return;
    }

    const tag = workflowTagInput.trim();
    if (!tag) {
      return;
    }

    commitWorkflowChange((current) => {
      const tags = current.tags ?? [];
      const duplicate = tags.some((currentTag) => (
        currentTag.localeCompare(tag, undefined, { sensitivity: "accent" }) === 0
      ));
      return duplicate ? current : { ...current, tags: [...tags, tag] };
    });
    setWorkflowTagInput("");
  }, [commitWorkflowChange, isEditorLocked, workflowTagInput]);

  const removeWorkflowTag = useCallback((tag: string) => {
    if (isEditorLocked) {
      return;
    }
    commitWorkflowChange((current) => ({
      ...current,
      tags: (current.tags ?? []).filter((currentTag) => currentTag !== tag),
    }));
  }, [commitWorkflowChange, isEditorLocked]);

  const commitSettingsChange = useCallback((
    updater: (settings: WorkflowSettings) => WorkflowSettings,
  ) => {
    if (isEditorLocked) {
      return;
    }
    commitWorkflowChange((current) => ({
      ...current,
      settings: updater({
        ...current.settings,
        timeout_seconds: workflowTimeoutSeconds(current),
        variables: workflowVariables(current),
      }),
    }));
  }, [commitWorkflowChange, isEditorLocked]);

  const updateWorkflowTimeoutSeconds = useCallback((rawValue: string) => {
    const timeoutSeconds = normalizeWorkflowTimeoutSeconds(rawValue);
    if (timeoutSeconds === null) {
      return;
    }
    commitSettingsChange((settings) => ({ ...settings, timeout_seconds: timeoutSeconds }));
  }, [commitSettingsChange]);

  const updateWorkflowMaxConcurrentRuns = useCallback((rawValue: string) => {
    const trimmedValue = rawValue.trim();
    const maxConcurrentRuns = trimmedValue ? Number(trimmedValue) : null;
    if (trimmedValue && (!Number.isFinite(maxConcurrentRuns) || !Number.isInteger(maxConcurrentRuns))) {
      return;
    }
    commitSettingsChange((settings) => ({ ...settings, max_concurrent_runs: maxConcurrentRuns }));
  }, [commitSettingsChange]);

  const updateWorkflowEnvironment = useCallback((environmentId: string) => {
    if (!environmentId) {
      return;
    }
    commitSettingsChange((settings) => ({ ...settings, environment_id: environmentId }));
  }, [commitSettingsChange]);

  const updateErrorWorkflow = useCallback((errorWorkflowId: string) => {
    commitSettingsChange((settings) => ({
      ...settings,
      error_workflow_id: errorWorkflowId || null,
    }));
  }, [commitSettingsChange]);

  const updateWorkflowVariables = useCallback((
    updater: (variables: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    commitSettingsChange((settings) => ({
      ...settings,
      variables: updater(settings.variables ?? {}),
    }));
  }, [commitSettingsChange]);

  const addWorkflowVariable = useCallback(() => {
    updateWorkflowVariables((variables) => ({
      ...variables,
      [nextWorkflowVariableName(variables)]: "",
    }));
  }, [updateWorkflowVariables]);

  const renameWorkflowVariable = useCallback((previousName: string, nextName: string) => {
    updateWorkflowVariables((variables) => {
      if (previousName !== nextName && nextName in variables) {
        return variables;
      }
      const nextVariables: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(variables)) {
        nextVariables[name === previousName ? nextName : name] = value;
      }
      return nextVariables;
    });
  }, [updateWorkflowVariables]);

  const updateWorkflowVariableValue = useCallback((name: string, value: string) => {
    updateWorkflowVariables((variables) => ({ ...variables, [name]: value }));
  }, [updateWorkflowVariables]);

  const removeWorkflowVariable = useCallback((name: string) => {
    updateWorkflowVariables((variables) => {
      const nextVariables = { ...variables };
      delete nextVariables[name];
      return nextVariables;
    });
  }, [updateWorkflowVariables]);

  return {
    addWorkflowTag,
    addWorkflowVariable,
    removeWorkflowTag,
    removeWorkflowVariable,
    renameWorkflowVariable,
    setWorkflowTagInput,
    updateErrorWorkflow,
    updateWorkflowDescription,
    updateWorkflowEnvironment,
    updateWorkflowMaxConcurrentRuns,
    updateWorkflowName,
    updateWorkflowTimeoutSeconds,
    updateWorkflowVariableValue,
    workflowTagInput,
  };
}

function normalizeWorkflowTimeoutSeconds(rawValue: string): number | null {
  const timeoutSeconds = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(timeoutSeconds)) {
    return null;
  }
  return Math.min(
    MAX_WORKFLOW_TIMEOUT_SECONDS,
    Math.max(MIN_WORKFLOW_TIMEOUT_SECONDS, timeoutSeconds),
  );
}
