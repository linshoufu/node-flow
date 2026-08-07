import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeType } from "../types";
import { NodeRuntimePanel } from "./NodeRuntimePanel";

describe("NodeRuntimePanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders focused runtime sections without depending on ConfigPanel", () => {
    render(
      <NodeRuntimePanel
        nodeTypeId="manual.trigger"
        navigationScope={["each", "iteration:0"]}
        sourceLabel="运行事件"
        runtimeState={{
          nodeId: "node_manual",
          status: "succeeded",
          inputs: { raw: "root-input" },
          outputs: { success: { raw: "root-output" } },
          durationMs: 7,
          logs: [{ level: "info", message: "standalone-log", fields: { case: "runtime" } }],
          scopes: [[], ["each", "iteration:0"]],
          events: [
            {
              type: "node_started",
              timestamp: "2026-06-22T10:00:00Z",
              scope: [],
              inputs: { row: 1 },
            },
          ],
          executions: [
            {
              runIndex: 0,
              status: "succeeded",
              scope: [],
              inputs: { row: "standalone" },
              outputs: {
                success: {
                  name: "success",
                  value: { ok: true },
                  items: [{ json: { ok: true } }],
                },
              },
              durationMs: 7,
              events: [],
            },
          ],
        }}
      />
    );

    expect(screen.getByText("状态：成功")).toBeInTheDocument();
    expect(screen.getByText("来源：运行事件")).toBeInTheDocument();
    expect(screen.getByText("范围：each / 第 1 轮")).toBeInTheDocument();
    expect(screen.getByText("耗时：7 ms")).toBeInTheDocument();
    const runtimeTabs = screen.getByRole("tablist", { name: "运行详情分区" });
    expect(within(runtimeTabs).getByRole("tab", { name: "执行数据" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("执行记录")).toBeInTheDocument();
    expect(screen.getByText(/standalone/)).toBeInTheDocument();
    expect(screen.queryByText("standalone-log")).not.toBeInTheDocument();

    fireEvent.click(within(runtimeTabs).getByRole("tab", { name: "日志" }));

    expect(screen.getByText("standalone-log")).toBeInTheDocument();
    expect(screen.queryByText("执行记录")).not.toBeInTheDocument();

    fireEvent.click(within(runtimeTabs).getByRole("tab", { name: "原始数据" }));

    expect(screen.getByText(/root-input/)).toBeInTheDocument();
    expect(screen.getByText(/root-output/)).toBeInTheDocument();
    expect(screen.getAllByText(/each \/ \u7b2c 1 \u8f6e/)).toHaveLength(2);
    expect(screen.queryByText(/each \/ iteration:0/)).not.toBeInTheDocument();
  });

  it("filters execution records by friendly scope text", () => {
    render(
      <NodeRuntimePanel
        nodeTypeId="manual.trigger"
        runtimeState={{
          nodeId: "node_manual",
          status: "succeeded",
          outputs: { success: { raw: "main-hit" } },
          scopes: [["each", "iteration:0"], []],
          events: [],
          executions: [
            {
              runIndex: 0,
              status: "succeeded",
              scope: ["each", "iteration:0"],
              inputs: { row: "loop" },
              outputs: {
                success: {
                  name: "success",
                  value: { raw: "loop-hit" },
                  items: [{ json: { raw: "loop-hit" } }],
                },
              },
              durationMs: 5,
              events: [
                {
                  type: "node_started",
                  timestamp: "2026-06-22T10:00:00Z",
                  scope: ["each", "iteration:0"],
                },
              ],
            },
            {
              runIndex: 1,
              status: "succeeded",
              scope: [],
              inputs: { row: "main" },
              outputs: {
                success: {
                  name: "success",
                  value: { raw: "main-hit" },
                  items: [{ json: { raw: "main-hit" } }],
                },
              },
              durationMs: 4,
              events: [],
            },
          ],
        }}
      />
    );

    expect(screen.getByLabelText("\u7b2c 2 \u6b21\u6267\u884c")).toBeInTheDocument();
    expect(screen.getByText(/main-hit/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("\u5b57\u6bb5\u3001\u503c\u3001\u65e5\u5fd7..."), {
      target: { value: "\u7b2c 1 \u8f6e" },
    });

    expect(screen.getByText(/\u627e\u5230 1 \u9879\u5339\u914d/)).toBeInTheDocument();
    expect(screen.getByLabelText("\u7b2c 1 \u6b21\u6267\u884c")).toBeInTheDocument();
    expect(screen.getByText(/loop-hit/)).toBeInTheDocument();
    expect(screen.queryByText(/main-hit/)).not.toBeInTheDocument();
  });

  it("shows logs and errors for the selected execution record", () => {
    render(
      <NodeRuntimePanel
        nodeTypeId="manual.trigger"
        runtimeState={{
          nodeId: "node_manual",
          status: "failed",
          scopes: [[]],
          events: [],
          executions: [
            {
              runIndex: 0,
              status: "failed",
              scope: [],
              inputs: { row: "main" },
              outputs: {},
              logs: [{ level: "error", message: "execution-log", fields: { status: 500 } }],
              error: { message: "execution-error" },
              durationMs: 9,
              events: [],
            },
          ],
        }}
      />
    );

    expect(screen.getByLabelText("\u7b2c 1 \u6b21\u6267\u884c")).toBeInTheDocument();
    expect(screen.getByText("execution-log")).toBeInTheDocument();
    expect(screen.getByText(/execution-error/)).toBeInTheDocument();
  });

  it("copies formatted runtime block JSON to the clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <NodeRuntimePanel
        nodeTypeId="manual.trigger"
        runtimeState={{
          nodeId: "node_manual",
          status: "failed",
          scopes: [[]],
          events: [],
          executions: [
            {
              runIndex: 0,
              status: "failed",
              scope: [],
              outputs: {},
              error: { message: "copy-me", status: 500 },
              durationMs: 9,
              events: [],
            },
          ],
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "\u590d\u5236 \u9519\u8bef" }));

    expect(writeText).toHaveBeenCalledWith(`{\n  "message": "copy-me",\n  "status": 500\n}`);
  });

  it("copies a single expanded output item JSON to the clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <NodeRuntimePanel
        nodeTypeId="manual.trigger"
        runtimeState={{
          nodeId: "node_manual",
          status: "succeeded",
          scopes: [[]],
          events: [],
          executions: [
            {
              runIndex: 0,
              status: "succeeded",
              scope: [],
              outputs: {
                success: {
                  name: "success",
                  value: [{ id: 1, name: "Alice" }],
                  items: [{ json: { id: 1, name: "Alice" } }],
                },
              },
              durationMs: 9,
              events: [],
            },
          ],
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "\u67e5\u770b success \u7684 1 \u9879\u660e\u7ec6" }));
    fireEvent.click(screen.getByRole("button", { name: "\u590d\u5236 success \u7b2c 1 \u9879" }));

    expect(writeText).toHaveBeenCalledWith(`{\n  "id": 1,\n  "name": "Alice"\n}`);
  });

  it("uses output port display names in execution data controls", () => {
    const nodeType: NodeType = {
      id: "http.request",
      name: "HTTP Request",
      category: "Network",
      description: "Send an HTTP request.",
      inputs: {},
      outputs: {
        success: { displayName: "响应" },
        error: { displayName: "错误", category: "error" },
      },
      configSchema: { type: "object" },
    };

    render(
      <NodeRuntimePanel
        nodeType={nodeType}
        nodeTypeId="http.request"
        runtimeState={{
          nodeId: "node_http",
          status: "succeeded",
          scopes: [[]],
          events: [],
          executions: [
            {
              runIndex: 0,
              status: "succeeded",
              scope: [],
              outputs: {
                success: {
                  name: "success",
                  value: { status_code: 200 },
                  items: [{ json: { status_code: 200 } }],
                },
              },
              durationMs: 9,
              events: [],
            },
          ],
        }}
      />
    );

    const outputSection = screen.getByRole("region", { name: "\u672c\u6b21\u8f93\u51fa" });
    expect(within(outputSection).getByRole("button", { name: "\u67e5\u770b \u54cd\u5e94 \u7684 1 \u9879\u660e\u7ec6" })).toBeInTheDocument();
    expect(within(outputSection).getByText("\u54cd\u5e94")).toBeInTheDocument();
    expect(within(outputSection).queryByText("success")).not.toBeInTheDocument();
  });

  it("shows clear empty states for nodes without executions or inputs", () => {
    const { rerender } = render(
      <NodeRuntimePanel
        nodeTypeId="manual.trigger"
        runtimeState={{
          nodeId: "node_manual",
          status: "pending",
          scopes: [],
          events: [],
          executions: [],
        }}
      />
    );

    expect(screen.getByText("这个节点还没有运行记录。")).toBeInTheDocument();

    rerender(
      <NodeRuntimePanel
        nodeTypeId="manual.trigger"
        runtimeState={{
          nodeId: "node_manual",
          status: "succeeded",
          scopes: [[]],
          events: [],
          executions: [
            {
              runIndex: 0,
              status: "succeeded",
              scope: [],
              outputs: {},
              durationMs: 3,
              events: [],
            },
          ],
        }}
      />
    );

    expect(screen.getByText("这次执行没有输入数据。")).toBeInTheDocument();
    expect(screen.getByText("这次执行没有输出端口数据。")).toBeInTheDocument();
  });

  it("groups selected execution details into input, output, and diagnostic sections", () => {
    render(
      <NodeRuntimePanel
        nodeTypeId="manual.trigger"
        runtimeState={{
          nodeId: "node_manual",
          status: "failed",
          scopes: [[]],
          events: [],
          executions: [
            {
              runIndex: 0,
              status: "failed",
              scope: [],
              inputs: { requestId: "r-1" },
              outputs: {
                error: {
                  name: "error",
                  value: { status: 500 },
                  items: [{ json: { status: 500 } }],
                },
              },
              logs: [{ level: "error", message: "diagnostic-log" }],
              error: { message: "diagnostic-error" },
              durationMs: 5,
              events: [],
            },
          ],
        }}
      />
    );

    const inputSection = screen.getByRole("region", { name: "\u672c\u6b21\u8f93\u5165" });
    const outputSection = screen.getByRole("region", { name: "\u672c\u6b21\u8f93\u51fa" });
    const diagnosticSection = screen.getByRole("region", { name: "\u672c\u6b21\u8bca\u65ad" });

    expect(within(inputSection).getByText(/requestId/)).toBeInTheDocument();
    expect(within(outputSection).getByText(/500/)).toBeInTheDocument();
    expect(within(diagnosticSection).getByText("diagnostic-log")).toBeInTheDocument();
    expect(within(diagnosticSection).getByText(/diagnostic-error/)).toBeInTheDocument();
  });

  it("collapses oversized runtime JSON blocks and expands them on demand", () => {
    const longMessage = "x".repeat(2500);
    const { container } = render(
      <NodeRuntimePanel
        nodeTypeId="manual.trigger"
        runtimeState={{
          nodeId: "node_manual",
          status: "failed",
          scopes: [],
          events: [],
          executions: [],
          error: { message: longMessage },
        }}
      />
    );

    // 错误块在“原始数据”分区展示
    fireEvent.click(screen.getByRole("tab", { name: "原始数据" }));

    // 错误块默认截断折叠，完整内容不直接渲染
    const errorPre = container.querySelector(".runtime-block pre") as HTMLPreElement;
    expect(errorPre.textContent ?? "").toContain("...");
    expect(errorPre.textContent ?? "").not.toContain(longMessage);

    fireEvent.click(screen.getByRole("button", { name: "展开错误完整内容" }));

    expect(errorPre.textContent ?? "").toContain(longMessage);
  });

  it("copies the full text of a collapsed runtime block", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText } });
    const longMessage = "z".repeat(2500);

    render(
      <NodeRuntimePanel
        nodeTypeId="manual.trigger"
        runtimeState={{
          nodeId: "node_manual",
          status: "failed",
          scopes: [],
          events: [],
          executions: [],
          error: { message: longMessage },
        }}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "原始数据" }));
    fireEvent.click(screen.getByRole("button", { name: "复制 错误" }));

    // 复制出口始终使用完整文本，不受截断影响
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain(longMessage);
  });
});

it("shows and expands the current loop item for an execution", () => {
  render(
    <NodeRuntimePanel
      nodeTypeId="utility.transform"
      runtimeState={{
        nodeId: "transform",
        status: "failed",
        scopes: [["each", "iteration:2"]],
        events: [],
        executions: [
          {
            runIndex: 0,
            status: "failed",
            scope: ["each", "iteration:2"],
            itemContext: {
              index: 2,
              item: { json: { caseId: "order-3" }, pairedItem: { item: 5 } },
            },
            outputs: {},
            error: { message: "request failed" },
            events: [],
          },
        ],
      }}
    />
  );

  const itemButton = screen.getByRole("button", { name: "查看第 3 项循环数据" });
  expect(itemButton).toBeInTheDocument();

  fireEvent.click(itemButton);

  expect(screen.getAllByText(/order-3/)).toHaveLength(2);
  expect(screen.getByText(/pairedItem/)).toBeInTheDocument();
});
