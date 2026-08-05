import { describe, expect, it } from "vitest";
import type { WorkflowDocument } from "../types";
import {
  WORKFLOW_EXPORT_FORMAT,
  WORKFLOW_EXPORT_VERSION,
  parseImportedWorkflow,
  serializeWorkflowExport,
  workflowExportFilename,
} from "./workflowTransfer";

const workflow: WorkflowDocument = {
  id: "wf_original",
  name: "接口回归流程",
  description: "验证关键接口的回归流程。",
  tags: ["接口", "回归"],
  version: 7,
  nodes: [
    {
      id: "manual",
      type: "manual.trigger",
      typeVersion: 1,
      position: { x: 10, y: 20 },
      config: { payload: { case: "smoke" } },
    },
  ],
  edges: [],
      settings: {
        timeout_seconds: 30,
        variables: { environment: "test" },
        error_workflow_id: null,
        max_concurrent_runs: null,
        environment_id: "default",
  },
};

describe("workflowTransfer", () => {
  it("exports a versioned workflow envelope", () => {
    const serialized = serializeWorkflowExport(workflow, "2026-07-17T08:00:00.000Z");

    expect(JSON.parse(serialized)).toEqual({
      format: WORKFLOW_EXPORT_FORMAT,
      version: WORKFLOW_EXPORT_VERSION,
      exportedAt: "2026-07-17T08:00:00.000Z",
      workflow: { ...workflow, active: true, annotations: [] },
    });
  });

  it("imports an exported workflow as a new normalized draft", () => {
    const imported = parseImportedWorkflow(serializeWorkflowExport(workflow));

    expect(imported).toMatchObject({
      name: "接口回归流程 副本",
      version: 1,
      nodes: workflow.nodes,
      edges: workflow.edges,
      settings: workflow.settings,
    });
    expect(imported.id).toMatch(/^wf_/);
    expect(imported.id).not.toBe(workflow.id);
    expect(imported.active).toBe(false);
    expect(imported.nodes).not.toBe(workflow.nodes);
  });

  it("accepts a legacy bare workflow document and fills missing defaults", () => {
    const imported = parseImportedWorkflow(
      JSON.stringify({
        id: "wf_legacy",
        name: "旧版流程",
        version: 3,
        nodes: [{ id: "log", type: "utility.log", position: { x: 0, y: 0 } }],
        edges: [],
      })
    );

    expect(imported.name).toBe("旧版流程 副本");
    expect(imported.nodes[0]).toMatchObject({ typeVersion: 1, config: {} });
    expect(imported.settings).toEqual({
      timeout_seconds: 600,
      variables: {},
      error_workflow_id: null,
      max_concurrent_runs: null,
      environment_id: "default",
    });
  });

  it("rejects malformed, incomplete, and newer-format files with clear messages", () => {
    expect(() => parseImportedWorkflow("not json")).toThrow("导入文件不是有效的 JSON。");
    expect(() => parseImportedWorkflow(JSON.stringify({ format: WORKFLOW_EXPORT_FORMAT, version: 2, workflow }))).toThrow(
      "暂不支持该工作流导出文件的版本。"
    );
    expect(() => parseImportedWorkflow(JSON.stringify({ id: "wf_missing" }))).toThrow("导入文件不包含有效的工作流内容。");
  });

  it("creates a filesystem-safe JSON filename from the workflow name", () => {
    expect(workflowExportFilename({ ...workflow, name: "接口 / 回归: 流程" })).toBe("接口-回归-流程.json");
    expect(workflowExportFilename({ ...workflow, name: "   " })).toBe("未命名工作流.json");
  });
});
