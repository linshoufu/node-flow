import { describe, expect, it } from "vitest";
import type { NodeTemplate, WorkflowDocument } from "@/types";
import { templateDraft } from "./templateLibrary";
import { templateDependencyIssue } from "./templateDependencies";

const workflow: WorkflowDocument = { id: "w", name: "Source", version: 1, settings: { timeout_seconds: 600, configuration: [{ name: "warehouse", label: "仓库", type: "json", default: { id: "one" } }, { name: "unused", type: "string", default: "unused" }] }, nodes: [{ id: "map", type: "data.records_prepare", position: { x: 0, y: 0 }, config: {}, configBindings: { "options.warehouse": { source: "workflow", key: "warehouse" } } }], edges: [] };

describe("user template snapshots", () => {
  it("copies a selected node with its explicit workflow dependencies", () => {
    const draft = templateDraft(workflow, [], "map", "node");
    expect(draft.configuration?.map((field) => field.name)).toEqual(["warehouse"]);
    expect(draft.node).toEqual(workflow.nodes[0]);
    draft.node!.config.changed = true;
    expect(workflow.nodes[0].config).toEqual({});
    expect(draft.parameters).toEqual([]);
  });
  it("rejects missing selections and empty templates without modifying the workflow", () => {
    expect(() => templateDraft(workflow, [], null, "node")).toThrow("选中");
    expect(() => templateDraft({ ...workflow, nodes: [] }, [], null, "workflow")).toThrow("空白");
    expect(() => templateDraft(workflow, [], null, "subflow")).toThrow("循环体");
  });
  it("checks runtime requirements and conflicting configuration before insertion", () => {
    const asset: NodeTemplate = { id: "user_demo", source: "user", packageId: "user", packageVersion: "1", ...templateDraft(workflow, [], "map", "node"), name: "Mine" };
    expect(templateDependencyIssue(asset, workflow)).toBe("");
    expect(templateDependencyIssue({ ...asset, configuration: [{ name: "warehouse", type: "string", default: "other" }] }, workflow)).toContain("不同定义");
    expect(templateDependencyIssue({ ...asset, parameters: [{ name: "file", type: "file" }] }, workflow)).toContain("运行参数");
  });
});
