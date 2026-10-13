import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NodePreview } from "./NodeStudio";
import type { NodeType } from "@/types";
import { NodeCard } from "./NodeCard";
import { createNodeInstance } from "@/lib/nodeInstance";
const cardMarkup = (html: string) => html.match(/<article[\s\S]*?<\/article>/)?.[0] ?? "";

const node: NodeType = {
  id: "logic.switch", name: "Switch", category: "Logic", description: "", icon: "git-fork",
  inputs: { input: { displayName: "输入" } }, outputs: { fallback: { displayName: "未匹配" } },
  configSchema: { properties: { rules: { default: [{ id: "first", label: "第一路" }, { id: "second", label: "第二路" }] } } },
  dynamicOutputs: { configKey: "rules", idKey: "id", labelKey: "label", output: {} },
};

describe("node studio preview", () => {
  it("renders the real card's connection points and dynamic outputs for its default configuration", () => {
    const html = cardMarkup(renderToStaticMarkup(createElement(NodePreview, { node, manifest: { version: 1 } })));
    expect(html).toContain("第一路");
    expect(html).toContain("第二路");
    expect(html).toContain("未匹配");
    expect(html.match(/data-handleid=/g)).toHaveLength(4);
  });
  it("resolves summary templates against actual defaults rather than showing template placeholders", () => {
    const html = cardMarkup(renderToStaticMarkup(createElement(NodePreview, {
      node: { ...node, configSchema: { properties: { method: { default: "POST" }, url: { default: "/orders" } } } },
      manifest: { version: 1, summaryTemplate: { badge: "{{method}}", primary: "{{url}}" } },
    })));
    expect(html).toContain("POST");
    expect(html).toContain("/orders");
    expect(html).not.toContain("{{method}}");
  });
  it("uses exactly the canvas card markup for the same node configuration and manifest", () => {
    const manifest = { version: 1, cardStyle: { density: "compact" as const }, portPresentation: { outputs: { first: { displayName: "自定义出口" } } } };
    const preview = cardMarkup(renderToStaticMarkup(createElement(NodePreview, { node, manifest })));
    const canvas = renderToStaticMarkup(createElement(NodeCard, { node: createNodeInstance(node, "canvas-node", { x: 0, y: 0 }), nodeType: node, manifest }));
    expect(preview).toBe(canvas);
  });
});
