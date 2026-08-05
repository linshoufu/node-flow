import type { WorkflowDocument } from "../types";
import { duplicateWorkflowDraft, normalizeWorkflowDocument } from "./workflow";

export const WORKFLOW_EXPORT_FORMAT = "node-flow/workflow";
export const WORKFLOW_EXPORT_VERSION = 1;

type WorkflowExportEnvelope = {
  format: typeof WORKFLOW_EXPORT_FORMAT;
  version: typeof WORKFLOW_EXPORT_VERSION;
  exportedAt: string;
  workflow: WorkflowDocument;
};

export function serializeWorkflowExport(workflow: WorkflowDocument, exportedAt = new Date().toISOString()): string {
  const envelope: WorkflowExportEnvelope = {
    format: WORKFLOW_EXPORT_FORMAT,
    version: WORKFLOW_EXPORT_VERSION,
    exportedAt,
    workflow: normalizeWorkflowDocument(workflow),
  };

  return JSON.stringify(envelope, null, 2);
}

export function parseImportedWorkflow(serialized: string): WorkflowDocument {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("导入文件不是有效的 JSON。");
  }

  const importedWorkflow = workflowFromImportPayload(parsed);
  if (!isWorkflowDocumentCandidate(importedWorkflow)) {
    throw new Error("导入文件不包含有效的工作流内容。");
  }

  return duplicateWorkflowDraft(normalizeWorkflowDocument(importedWorkflow));
}

export function workflowExportFilename(workflow: WorkflowDocument): string {
  const baseName = workflow.name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);

  return `${baseName || "未命名工作流"}.json`;
}

function workflowFromImportPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return undefined;
  }

  if ("format" in payload || "workflow" in payload) {
    if (payload.format !== WORKFLOW_EXPORT_FORMAT || payload.version !== WORKFLOW_EXPORT_VERSION) {
      throw new Error("暂不支持该工作流导出文件的版本。");
    }
    return payload.workflow;
  }

  return payload;
}

function isWorkflowDocumentCandidate(value: unknown): value is WorkflowDocument {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.version === "number" &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
