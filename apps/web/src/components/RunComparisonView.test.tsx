import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunComparisonView } from "./RunComparisonView";

describe("RunComparisonView", () => {
  afterEach(() => cleanup());

  it("shows changed and unchanged node summaries in Chinese", () => {
    render(
      <RunComparisonView
        comparison={{
          nodeCount: 2,
          changedNodeCount: 1,
          unchangedNodeCount: 1,
          nodes: [
            {
              nodeId: "assert",
              change: "changed",
              baseline: summary({ latestStatus: "succeeded", outputItemCount: 1 }),
              current: summary({ latestStatus: "failed", outputItemCount: 2, errorCount: 1 }),
              inputChanged: false,
              outputChanged: true,
            },
            {
              nodeId: "request",
              change: "unchanged",
              baseline: summary(),
              current: summary(),
              inputChanged: false,
              outputChanged: false,
            },
          ],
        }}
        nodeDisplayNames={{ assert: "状态断言", request: "登录请求" }}
      />
    );

    expect(screen.getByText("1 个节点有变化")).toBeInTheDocument();
    expect(screen.getByText("状态断言")).toBeInTheDocument();
    expect(screen.getByText("成功 -> 失败")).toBeInTheDocument();
    expect(screen.getByText("输出数据已变化")).toBeInTheDocument();
    expect(screen.getByText("登录请求")).toBeInTheDocument();
    expect(screen.getByText("未变化")).toBeInTheDocument();
  });

  it("opens a changed node on the canvas", () => {
    const onSelectNode = vi.fn();
    render(
      <RunComparisonView
        comparison={{
          nodeCount: 1,
          changedNodeCount: 1,
          unchangedNodeCount: 0,
          nodes: [
            {
              nodeId: "assert",
              change: "added",
              baseline: null,
              current: summary(),
              inputChanged: false,
              outputChanged: false,
            },
          ],
        }}
        nodeDisplayNames={{ assert: "状态断言" }}
        onSelectNode={onSelectNode}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看差异节点 状态断言" }));

    expect(onSelectNode).toHaveBeenCalledWith("assert");
  });
});

function summary(overrides = {}) {
  return {
    nodeId: "node",
    runCount: 1,
    latestStatus: "succeeded" as const,
    inputItemCount: 1,
    outputConnectionCount: 1,
    outputItemCount: 1,
    errorCount: 0,
    ...overrides,
  };
}
