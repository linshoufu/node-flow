import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeTemplate, NodeType, WorkflowDocument, WorkflowNode } from "@/types";
import { useWorkflowStore } from "@/store/workflow";
import { bindingAllowed, configPathUpdate, ExtraConfigurationFields, FieldValueSource } from "./FieldValueSource";
import { templateUnavailable } from "./NodePalette";

vi.mock("@/store/workflow", async (original) => {
  const actual = await original<typeof import("@/store/workflow")>();
  const store = actual.useWorkflowStore;
  return { ...actual, useWorkflowStore: Object.assign((selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()), store) };
});

const nodeType: NodeType = { id: "data.example", name: "Example", category: "Data", description: "", icon: "table", inputs: {}, outputs: {}, configSchema: { properties: { options: { type: "object" } } }, form: { groups: [{ id: "main", label: "Rules", fields: [{ key: "columns", control: "column_rules" }] }] } };
const node: WorkflowNode = { id: "example", type: "data.example", position: { x: 0, y: 0 }, config: {}, configBindings: { "options.warehouse": { source: "workflow", key: "warehouse" } } };
const workflow: WorkflowDocument = { id: "test", name: "Test", version: 1, nodes: [node], edges: [], settings: { timeout_seconds: 600, run_mode: "preview", configuration: [{ name: "warehouse", label: "默认仓库", type: "json", default: { name: "一号仓库", id: "demo" } }] } };
const before = useWorkflowStore.getState();
afterEach(() => useWorkflowStore.setState(before, true));

describe("field value sources", () => {
  it("places the source and a readable current value beside the field, without changing stored configuration", () => {
    useWorkflowStore.setState({ workflow: structuredClone(workflow) });
    const html = renderToStaticMarkup(createElement(ExtraConfigurationFields, { node, nodeType }));
    expect(html).toContain("默认仓库取值方式");
    expect(html).toContain("工作流配置 · 默认仓库");
    expect(html).toContain("一号仓库 · 2 个字段");
    expect(html).not.toContain("绑定目标路径");
    expect(html).not.toContain("配置绑定");
    expect(useWorkflowStore.getState().workflow).toEqual(workflow);
  });
  it("does not show binding controls for parameter declarations or dynamic port definitions", () => {
    const parameter = { ...nodeType, id: "workflow.parameters" };
    expect(renderToStaticMarkup(createElement(ExtraConfigurationFields, { node, nodeType: parameter }))).toBe("");
    expect(bindingAllowed(parameter, "input_path")).toBe(false);
    expect(bindingAllowed({ ...nodeType, dynamicOutputs: { configKey: "fields", idKey: "name", labelKey: "label", output: {} } }, "fields")).toBe(false);
  });
  it("keeps fixed options editable after removing the final nested reference", () => {
    useWorkflowStore.setState({ workflow: structuredClone(workflow) });
    const fixed = { ...node, configBindings: {}, config: { options: { warehouse: "fixed" } } };
    const html = renderToStaticMarkup(createElement(ExtraConfigurationFields, { node: fixed, nodeType }));
    expect(html).toContain("默认仓库取值方式");
    expect(html).toContain('value="fixed"');
  });
  it("preserves a missing reference and identifies it instead of silently using a fixed value", () => {
    useWorkflowStore.setState({ workflow: { ...workflow, settings: { timeout_seconds: 600 } } });
    const html = renderToStaticMarkup(createElement(FieldValueSource, { node, nodeType, path: "options.warehouse", label: "仓库", children: "固定编辑器" }));
    expect(html).toContain("引用已失效");
    expect(html).toContain("找不到此配置");
    expect(html).not.toContain("固定编辑器");
  });
  it("edits a nested fixed value without changing siblings or the original config", () => {
    const original = { options: { warehouse: { id: "old", name: "keep" }, other: false } };
    expect(configPathUpdate(original, "options.warehouse.id", "new")).toEqual(["options", { warehouse: { id: "new", name: "keep" }, other: false }]);
    expect(original.options.warehouse.id).toBe("old");
  });
});

describe("library template eligibility", () => {
  const template: NodeTemplate = { id: "t", name: "Template", kind: "workflow", packageId: "demo", packageVersion: "1" };
  it("explains why a workflow or loop template cannot be added while presets remain available", () => {
    expect(templateUnavailable(template, false, false, false)).toContain("空白工作流");
    expect(templateUnavailable(template, true, false, false)).toBe("");
    expect(templateUnavailable({ ...template, kind: "subflow" }, true, false, true)).toContain("空白循环体");
    expect(templateUnavailable({ ...template, kind: "subflow" }, false, true, true)).toBe("");
    expect(templateUnavailable({ ...template, kind: "node" }, false, true, false)).toBe("");
  });
});
