import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowWorkbenchLayout } from "./WorkflowWorkbenchLayout";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const resetKeys = {
  canvas: "canvas-1",
  inspector: "inspector-1",
  nodeLibrary: "library-1",
  runLog: "run-1",
};

function renderLayout(overrides: Partial<Parameters<typeof WorkflowWorkbenchLayout>[0]> = {}) {
  return render(
    <WorkflowWorkbenchLayout
      canvas={<div>画布内容</div>}
      inspector={<div>配置内容</div>}
      nodeLibrary={<div>节点库内容</div>}
      resetKeys={resetKeys}
      runLog={<div>运行日志内容</div>}
      {...overrides}
    />,
  );
}

describe("WorkflowWorkbenchLayout", () => {
  it("按稳定顺序呈现四个工作区插槽", () => {
    const { container } = renderLayout();
    const workspace = container.querySelector("main.workspace-grid");

    expect(workspace).not.toBeNull();
    expect(workspace).toHaveTextContent("节点库内容画布内容配置内容运行日志内容");
  });

  it("将单个区域的渲染故障隔离在对应插槽", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderLayout({ canvas: <ThrowRenderError message="canvas failed" /> });

    expect(screen.getByRole("alert", { name: "画布故障恢复" })).toHaveTextContent("画布暂时无法显示");
    expect(screen.getByText("节点库内容")).toBeInTheDocument();
    expect(screen.getByText("配置内容")).toBeInTheDocument();
    expect(screen.getByText("运行日志内容")).toBeInTheDocument();
  });

  it("区域上下文变化后自动清除旧故障", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender } = renderLayout({ canvas: <ThrowRenderError message="canvas failed" /> });
    expect(screen.getByRole("alert", { name: "画布故障恢复" })).toBeInTheDocument();

    rerender(
      <WorkflowWorkbenchLayout
        canvas={<div>恢复后的画布</div>}
        inspector={<div>配置内容</div>}
        nodeLibrary={<div>节点库内容</div>}
        resetKeys={{ ...resetKeys, canvas: "canvas-2" }}
        runLog={<div>运行日志内容</div>}
      />,
    );

    expect(screen.getByText("恢复后的画布")).toBeInTheDocument();
    expect(screen.queryByRole("alert", { name: "画布故障恢复" })).not.toBeInTheDocument();
  });

  it("专注模式下节点库仍可展开成悬浮覆盖层添加节点", () => {
    renderLayout({ focusMode: true, onToggleFocusMode: vi.fn() });

    // 进入专注模式后节点库默认收成贴边轨道，不再占据布局列
    expect(screen.queryByText("节点库内容")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开节点库" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开节点库" }));
    expect(screen.getByText("节点库内容")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "收起节点库" }));
    expect(screen.queryByText("节点库内容")).not.toBeInTheDocument();
  });

  it("专注模式下配置面板同样可展开成悬浮覆盖层编辑节点", () => {
    renderLayout({ focusMode: true, onToggleFocusMode: vi.fn() });

    expect(screen.queryByText("配置内容")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开配置面板" }));
    expect(screen.getByText("配置内容")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "收起配置面板" }));
    expect(screen.queryByText("配置内容")).not.toBeInTheDocument();
  });

  it("退出专注模式后悬浮节点库自动收起并恢复常规列布局", () => {
    const { rerender } = renderLayout({ focusMode: true, onToggleFocusMode: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "展开节点库" }));
    expect(screen.getByText("节点库内容")).toBeInTheDocument();

    rerender(
      <WorkflowWorkbenchLayout
        canvas={<div>画布内容</div>}
        inspector={<div>配置内容</div>}
        nodeLibrary={<div>节点库内容</div>}
        resetKeys={resetKeys}
        runLog={<div>运行日志内容</div>}
      />,
    );

    expect(screen.getByText("节点库内容")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起节点库" })).toBeInTheDocument();
  });
});

class ThrowRenderError extends Component<{ message: string }> {
  render(): ReactNode {
    throw new Error(this.props.message);
  }
}
