import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunEvent } from "../types";
import { RunPanel } from "./RunPanel";

describe("RunPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the test report tab by default", () => {
    render(<RunPanel events={[recordResultEvent("record-login", { name: "登录接口", status: "passed" })]} run={null} />);

    expect(screen.getByRole("tab", { name: "测试报告" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("登录接口")).toBeInTheDocument();
    expect(screen.queryByText("record-login")).not.toBeInTheDocument();
  });

  it("shows run events after switching tabs and still selects event nodes", () => {
    const onSelectNode = vi.fn();
    const events: RunEvent[] = [
      runEvent({
        id: 1,
        type: "node_succeeded",
        node_id: "request",
        scope: ["each", "iteration:0"],
        payload: { duration_ms: 8, outputs: { success: { ok: true } } },
      }),
    ];

    render(<RunPanel events={events} run={null} onSelectNode={onSelectNode} />);

    fireEvent.click(screen.getByRole("tab", { name: "运行事件" }));
    fireEvent.click(screen.getByRole("button", { name: /request/ }));

    expect(onSelectNode).toHaveBeenCalledWith("request");
    expect(screen.getByText("each / iteration:0")).toBeInTheDocument();
  });

  it("updates report data when events change", () => {
    const { rerender } = render(
      <RunPanel events={[recordResultEvent("record-login", { name: "登录接口", status: "passed" })]} run={null} />
    );

    expect(screen.getByText("登录接口")).toBeInTheDocument();

    rerender(<RunPanel events={[recordResultEvent("record-profile", { name: "资料接口", status: "failed" })]} run={null} />);

    expect(screen.getByText("资料接口")).toBeInTheDocument();
    expect(screen.queryByText("登录接口")).not.toBeInTheDocument();
  });
});

function recordResultEvent(nodeId: string, result: Record<string, unknown>): RunEvent {
  return runEvent({
    type: "node_succeeded",
    node_id: nodeId,
    payload: {
      node_type: "test.record_result",
      outputs: {
        success: { case: result },
      },
    },
  });
}

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
