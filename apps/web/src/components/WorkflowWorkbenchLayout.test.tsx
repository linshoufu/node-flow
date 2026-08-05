import { cleanup, render, screen } from "@testing-library/react";
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
});

class ThrowRenderError extends Component<{ message: string }> {
  render(): ReactNode {
    throw new Error(this.props.message);
  }
}
