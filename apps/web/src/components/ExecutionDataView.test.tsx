import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildExecutionData } from "../lib/executionData";
import type { NodeType, RunEvent } from "../types";
import { ExecutionDataView } from "./ExecutionDataView";

describe("ExecutionDataView", () => {
  afterEach(() => {
    cleanup();
  });

  it("filters execution data by search text and exposes status counts", () => {
    const onStatusFilterChange = vi.fn();
    const data = buildExecutionData([
      runEvent({ id: 1, type: "node_started", node_id: "request", payload: { inputs: { url: "/login" } } }),
      runEvent({ id: 2, type: "node_succeeded", node_id: "request", payload: { outputs: { success: { status_code: 200 } } } }),
      runEvent({ id: 3, type: "node_failed", node_id: "assert", payload: { error: { message: "status mismatch" } } }),
    ]);

    render(
      <ExecutionDataView
        data={data}
        nodeDisplayNames={{ assert: "状态断言", request: "登录请求" }}
        statusFilter="all"
        onStatusFilterChange={onStatusFilterChange}
      />
    );

    expect(screen.getByRole("button", { name: "全部" })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "失败" })).toHaveTextContent("1");

    fireEvent.change(screen.getByLabelText("搜索执行数据"), { target: { value: "login" } });

    expect(screen.getByText("登录请求")).toBeInTheDocument();
    expect(screen.queryByText("状态断言")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "失败" }));

    expect(onStatusFilterChange).toHaveBeenCalledWith("failed");
  });

  it("selects a node execution while keeping display names separate from node ids", () => {
    const onSelectNode = vi.fn();
    const data = buildExecutionData([
      runEvent({
        id: 1,
        type: "node_started",
        node_id: "request",
        scope: ["each", "iteration:0"],
        payload: { inputs: { row: 1 } },
      }),
      runEvent({
        id: 2,
        type: "node_succeeded",
        node_id: "request",
        scope: ["each", "iteration:0"],
        payload: { outputs: { success: [{ ok: true }] } },
      }),
    ]);

    render(
      <ExecutionDataView
        data={data}
        nodeDisplayNames={{ request: "登录请求" }}
        statusFilter="all"
        onSelectNode={onSelectNode}
        onStatusFilterChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看执行数据 登录请求 第 1 次" }));

    expect(screen.getByText("each / 第 1 轮")).toBeInTheDocument();
    expect(screen.queryByText("each / iteration:0")).not.toBeInTheDocument();
    expect(onSelectNode).toHaveBeenCalledWith({
      nodeId: "request",
      scope: ["each", "iteration:0"],
      source: "execution_data",
    });
  });

  it("filters scoped executions by friendly iteration text", () => {
    const data = buildExecutionData([
      runEvent({
        id: 1,
        type: "node_started",
        node_id: "request",
        scope: ["each", "iteration:0"],
        payload: { inputs: { row: 1 } },
      }),
      runEvent({
        id: 2,
        type: "node_succeeded",
        node_id: "request",
        scope: ["each", "iteration:0"],
        payload: { outputs: { success: { ok: true } } },
      }),
      runEvent({
        id: 3,
        type: "node_started",
        node_id: "assert",
        scope: ["each", "iteration:1"],
        payload: { inputs: { row: 2 } },
      }),
    ]);

    render(
      <ExecutionDataView
        data={data}
        nodeDisplayNames={{ assert: "状态断言", request: "登录请求" }}
        statusFilter="all"
        onStatusFilterChange={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("搜索执行数据"), { target: { value: "第 1 轮" } });

    expect(screen.getByText("登录请求")).toBeInTheDocument();
    expect(screen.queryByText("状态断言")).not.toBeInTheDocument();
  });

  it("uses output port display names in execution data cards and search", () => {
    const data = buildExecutionData([
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
        payload: { outputs: { success: { status_code: 200 } } },
      }),
    ]);

    render(
      <ExecutionDataView
        data={data}
        nodeDisplayNames={{ request: "登录请求" }}
        nodeTypesByNodeId={{ request: requestNodeType }}
        statusFilter="all"
        onStatusFilterChange={vi.fn()}
      />
    );

    expect(screen.getByText("响应")).toBeInTheDocument();
    expect(screen.queryByText("success")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("搜索执行数据"), { target: { value: "响应" } });

    expect(screen.getByText("登录请求")).toBeInTheDocument();
  });
});

const requestNodeType: NodeType = {
  id: "http.request",
  name: "HTTP Request",
  displayName: "请求",
  category: "action",
  description: "Send a request",
  inputs: {},
  outputs: {
    success: {
      displayName: "响应",
    },
  },
  configSchema: {
    type: "object",
    properties: {},
  },
};

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
