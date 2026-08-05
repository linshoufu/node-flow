import { describe, expect, it } from "vitest";
import {
  buildNodeRuntimeTarget,
  nodeRuntimeSourceLabel,
  type NodeRuntimeNavigationSource,
} from "./nodeRuntimeNavigation";

describe("nodeRuntimeNavigation", () => {
  it("normalizes a runtime navigation target without sharing the caller scope array", () => {
    const scope = ["each", "iteration:0"];
    const target = buildNodeRuntimeTarget("request", "execution_data", scope);

    scope.push("mutated");

    expect(target).toEqual({
      nodeId: "request",
      scope: ["each", "iteration:0"],
      source: "execution_data",
    });
  });

  it("labels every runtime navigation source in Chinese", () => {
    const sources: NodeRuntimeNavigationSource[] = ["canvas", "execution_data", "run_event", "test_report", "focused_node"];

    expect(sources.map(nodeRuntimeSourceLabel)).toEqual([
      "画布节点",
      "执行数据",
      "运行事件",
      "测试报告",
      "当前节点详情",
    ]);
  });
});
