import type { WorkflowDocument } from "../types";
import { normalizeWorkflowDocument } from "./workflow";

type WorkflowSaveStateInput = {
  workflow: WorkflowDocument;
  cleanWorkflowSnapshot: string | null;
  selectedWorkflowId: string;
};

export type WorkflowSaveState = {
  canSave: boolean;
  isDirty: boolean;
  label: "草稿" | "未保存" | "已保存";
  className: "is-draft" | "is-dirty" | "is-saved";
  saveDisabledReason: string | null;
  shouldSaveBeforeRun: boolean;
};

export type WorkflowSaveActionState = {
  disabled: boolean;
  title: string;
};

export function serializeWorkflowForSaveState(workflow: WorkflowDocument): string {
  return stableStringify(normalizeWorkflowDocument(workflow));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (!isJsonObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)])
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildWorkflowSaveState({
  workflow,
  cleanWorkflowSnapshot,
  selectedWorkflowId,
}: WorkflowSaveStateInput): WorkflowSaveState {
  const workflowSnapshot = serializeWorkflowForSaveState(workflow);
  const isDirty = cleanWorkflowSnapshot === null || workflowSnapshot !== cleanWorkflowSnapshot;

  if (isDirty) {
    return {
      canSave: true,
      isDirty: true,
      label: "未保存",
      className: "is-dirty",
      saveDisabledReason: null,
      shouldSaveBeforeRun: true,
    };
  }

  if (selectedWorkflowId) {
    return {
      canSave: false,
      isDirty: false,
      label: "已保存",
      className: "is-saved",
      saveDisabledReason: "当前版本没有未保存变更",
      shouldSaveBeforeRun: false,
    };
  }

  return {
    canSave: true,
    isDirty: false,
    label: "草稿",
    className: "is-draft",
    saveDisabledReason: null,
    shouldSaveBeforeRun: true,
  };
}

export function buildWorkflowSaveActionState(
  workflowSaveState: WorkflowSaveState,
  isBusy: boolean
): WorkflowSaveActionState {
  if (isBusy) {
    return {
      disabled: true,
      title: "正在处理，请稍候",
    };
  }

  if (!workflowSaveState.canSave) {
    return {
      disabled: true,
      title: workflowSaveState.saveDisabledReason ?? "当前工作流暂时不能保存",
    };
  }

  return {
    disabled: false,
    title: "保存当前工作流",
  };
}
