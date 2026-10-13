import { describe, expect, it } from "vitest";
import type { NodeType } from "@/types";
import { createNodeInstance, resolveNodePorts } from "./nodeInstance";
const type: NodeType = { id: "dynamic", name: "Dynamic", description: "", category: "Data", inputs: { start: {} }, outputs: { done: { displayName: "完成" } }, configSchema: { properties: { routes: { default: [{ id: "first", label: "第一路" }] } } }, dynamicOutputs: { configKey: "routes", idKey: "id", labelKey: "label", output: { category: "control" } } };
describe("node instance presentation", () => {
  it("keeps static ports and resolves configured dynamic labels and metadata", () => {
    expect(resolveNodePorts(type, { routes: [{ id: "other", label: "另一出口" }] }, "outputs")).toEqual({ done: { displayName: "完成" }, other: { category: "control", displayName: "另一出口" } });
    expect(Object.keys(resolveNodePorts(type, {}, "outputs"))).toEqual(["done", "first"]);
  });
  it("retains only static ports for malformed or colliding dynamic configuration", () => {
    for (const routes of [null, "bad", [{ id: "bad-id", label: "错误" }], [{ id: "done", label: "覆盖" }], [{ id: "a", label: "A" }, { id: "a", label: "B" }]]) expect(resolveNodePorts(type, { routes }, "outputs")).toEqual(type.outputs);
  });
  it("creates independent defaults so editing a preview does not mutate the catalog or another node", () => {
    const first = createNodeInstance(type, "first", { x: 0, y: 0 });
    (first.config.routes as Array<{ label: string }>)[0].label = "编辑";
    expect((createNodeInstance(type, "second", { x: 0, y: 0 }).config.routes as Array<{ label: string }>)[0].label).toBe("第一路");
  });
});
