import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunEvent } from "../types";
import { RunEventList } from "./RunEventList";

describe("RunEventList", () => {
  afterEach(() => {
    cleanup();
  });

  it("filters events by display name and payload text", () => {
    render(
      <RunEventList
        events={[
          runEvent({
            id: 1,
            type: "node_succeeded",
            node_id: "request",
            payload: { outputs: { success: { status_code: 200 } } },
          }),
          runEvent({
            id: 2,
            type: "node_failed",
            node_id: "assert",
            payload: { error: { message: "status mismatch" } },
          }),
        ]}
        nodeDisplayNames={{ assert: "状态断言", request: "登录请求" }}
      />
    );

    fireEvent.change(screen.getByLabelText("搜索运行事件"), { target: { value: "状态断言" } });

    expect(screen.queryByText("登录请求")).not.toBeInTheDocument();
    expect(screen.getByText("状态断言")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("搜索运行事件"), { target: { value: "status_code" } });

    expect(screen.getByText("登录请求")).toBeInTheDocument();
    expect(screen.queryByText("状态断言")).not.toBeInTheDocument();
  });

  it("selects the event node using its node id and scope", () => {
    const onSelectNode = vi.fn();

    render(
      <RunEventList
        events={[
          runEvent({
            id: 1,
            type: "node_succeeded",
            node_id: "request",
            scope: ["each", "iteration:0"],
          }),
        ]}
        nodeDisplayNames={{ request: "登录请求" }}
        onSelectNode={onSelectNode}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "节点成功 登录请求" }));

    expect(screen.getByText("each / 第 1 轮")).toBeInTheDocument();
    expect(screen.queryByText("each / iteration:0")).not.toBeInTheDocument();
    expect(onSelectNode).toHaveBeenCalledWith({
      nodeId: "request",
      scope: ["each", "iteration:0"],
      source: "run_event",
    });
  });

  it("filters scoped events by friendly iteration text", () => {
    render(
      <RunEventList
        events={[
          runEvent({
            id: 1,
            type: "node_succeeded",
            node_id: "request",
            scope: ["each", "iteration:0"],
          }),
          runEvent({
            id: 2,
            type: "node_succeeded",
            node_id: "assert",
            scope: ["each", "iteration:1"],
          }),
        ]}
        nodeDisplayNames={{ assert: "状态断言", request: "登录请求" }}
      />
    );

    fireEvent.change(screen.getByLabelText("搜索运行事件"), { target: { value: "第 1 轮" } });

    expect(screen.getByText("登录请求")).toBeInTheDocument();
    expect(screen.queryByText("状态断言")).not.toBeInTheDocument();
  });

  it("opens the related error workflow run from its lineage event", () => {
    const onOpenChildRun = vi.fn();
    render(
      <RunEventList
        events={[runEvent({ id: 1, type: "error_workflow_started", payload: { error_run_id: "run_error" } })]}
        nodeDisplayNames={{}}
        onOpenChildRun={onOpenChildRun}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看错误处理运行" }));

    expect(screen.getByText("错误处理已启动")).toBeInTheDocument();
    expect(onOpenChildRun).toHaveBeenCalledWith("run_error");
  });

  it("opens the retry run from a retry lineage event", () => {
    const onOpenChildRun = vi.fn();
    render(
      <RunEventList
        events={[runEvent({ id: 1, type: "run_retry_requested", payload: { retry_run_id: "run_retry" } })]}
        nodeDisplayNames={{}}
        onOpenChildRun={onOpenChildRun}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看重试运行" }));

    expect(onOpenChildRun).toHaveBeenCalledWith("run_retry");
  });

  it("truncates oversized payloads by default and expands them on demand", () => {
    const fullJson = JSON.stringify({ message: "x".repeat(300) });
    render(
      <RunEventList events={[runEvent({ id: 1, payload: { message: "x".repeat(300) } })]} nodeDisplayNames={{}} />
    );

    // 默认截断展示，完整 JSON 不直接出现在行内
    expect(screen.queryByText(fullJson)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开" }));

    expect(screen.getByText(fullJson)).toBeInTheDocument();
  });

  it("copies the full payload JSON from a truncated event row", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText } });
    const payload = { message: "y".repeat(300) };
    render(<RunEventList events={[runEvent({ id: 1, payload })]} nodeDisplayNames={{}} />);

    fireEvent.click(screen.getByRole("button", { name: "复制完整 JSON" }));

    expect(writeText).toHaveBeenCalledWith(JSON.stringify(payload));
    expect(await screen.findByText("已复制")).toBeInTheDocument();
  });

  it("renders only the visible window of rows when virtualization is forced on", () => {
    const events = Array.from({ length: 50 }, (_, index) =>
      runEvent({ id: index + 1, payload: { message: `event-${index}` } }),
    );
    const { container } = render(<RunEventList events={events} nodeDisplayNames={{}} virtualization="on" />);

    // 顶部可视区：首行渲染，远离视口的行不渲染
    expect(screen.getByText(JSON.stringify({ message: "event-0" }))).toBeInTheDocument();
    expect(screen.queryByText(JSON.stringify({ message: "event-49" }))).not.toBeInTheDocument();

    // 滚动到底部附近后，尾部行进入可视区、顶部行离开
    fireEvent.scroll(container.querySelector(".run-events") as HTMLElement, { target: { scrollTop: 49 * 36 } });

    expect(screen.getByText(JSON.stringify({ message: "event-49" }))).toBeInTheDocument();
    expect(screen.queryByText(JSON.stringify({ message: "event-0" }))).not.toBeInTheDocument();
  });

  it("auto-scrolls to the bottom when new events arrive while staying pinned", () => {
    const { container, rerender } = render(
      <RunEventList events={[runEvent({ id: 1 })]} nodeDisplayNames={{}} />,
    );
    const scroller = container.querySelector(".run-events") as HTMLElement;
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 500 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 200 });

    rerender(<RunEventList events={[runEvent({ id: 1 }), runEvent({ id: 2 })]} nodeDisplayNames={{}} />);

    expect(scroller.scrollTop).toBe(300);
  });

  it("keeps the reading position after the user scrolls up to review history", () => {
    const events = [runEvent({ id: 1 }), runEvent({ id: 2 })];
    const { container, rerender } = render(<RunEventList events={events} nodeDisplayNames={{}} />);
    const scroller = container.querySelector(".run-events") as HTMLElement;
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 500 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 200 });

    // 手动上滚后不再贴底
    fireEvent.scroll(scroller, { target: { scrollTop: 100 } });

    rerender(<RunEventList events={[...events, runEvent({ id: 3 })]} nodeDisplayNames={{}} />);

    expect(scroller.scrollTop).toBe(100);
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
