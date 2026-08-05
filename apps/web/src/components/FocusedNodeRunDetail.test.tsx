import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildExecutionData } from "../lib/executionData";
import { buildNodeRunDetail } from "../lib/nodeRunDetail";
import type { RunEvent } from "../types";
import { FocusedNodeRunDetail } from "./FocusedNodeRunDetail";

describe("FocusedNodeRunDetail", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the latest focused node execution with friendly display text", () => {
    const detail = buildNodeRunDetail(
      buildExecutionData([
        runEvent({
          id: 1,
          type: "node_started",
          node_id: "request",
          payload: { inputs: { url: "/login" } },
        }),
        runEvent({
          id: 2,
          type: "node_succeeded",
          node_id: "request",
          payload: { duration_ms: 18, outputs: { success: { status_code: 200 } } },
        }),
      ]),
      "request"
    );

    render(<FocusedNodeRunDetail detail={detail} nodeDisplayNames={{ request: "登录请求" }} />);

    expect(screen.getByRole("heading", { name: "当前节点详情" })).toBeInTheDocument();
    expect(screen.getByText("登录请求")).toBeInTheDocument();
    expect(screen.getByText("最近成功")).toBeInTheDocument();
    expect(screen.getByText("耗时 18 ms")).toBeInTheDocument();
    expect(screen.getByText("输入 1 项")).toBeInTheDocument();
    expect(screen.getByText("输出 1 项")).toBeInTheDocument();
    expect(screen.getByText(/"status_code":200/)).toBeInTheDocument();
    expect(screen.queryByText("request")).not.toBeInTheDocument();
  });

  it("selects the node runtime detail with the real node id and latest scope", () => {
    const onSelectNode = vi.fn();
    const detail = buildNodeRunDetail(
      buildExecutionData([
        runEvent({
          id: 1,
          type: "node_started",
          node_id: "request",
          scope: ["each", "iteration:0"],
          payload: { inputs: { row: 1 } },
        }),
      ]),
      "request"
    );

    render(
      <FocusedNodeRunDetail
        detail={detail}
        nodeDisplayNames={{ request: "登录请求" }}
        onSelectNode={onSelectNode}
      />
    );

    expect(screen.getByText("each / 第 1 轮")).toBeInTheDocument();
    expect(screen.queryByText("each / iteration:0")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开节点运行详情" }));

    expect(onSelectNode).toHaveBeenCalledWith({
      nodeId: "request",
      scope: ["each", "iteration:0"],
      source: "focused_node",
    });
  });
});

function runEvent(overrides: Partial<RunEvent>): RunEvent {
  return {
    run_id: "run_1",
    type: "node_started",
    timestamp: "2026-06-18T00:00:00Z",
    node_id: null,
    scope: [],
    payload: {},
    ...overrides,
  };
}
