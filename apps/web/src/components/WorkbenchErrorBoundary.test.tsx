import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchErrorBoundary } from "./WorkbenchErrorBoundary";

describe("WorkbenchErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("replaces a crashed root with Chinese recovery actions", () => {
    const onError = vi.fn();
    const onReload = vi.fn();
    const onOpenBlank = vi.fn();
    render(
      <WorkbenchErrorBoundary
        onError={onError}
        onOpenBlank={onOpenBlank}
        onReload={onReload}
      >
        <Crash message="render exploded" />
      </WorkbenchErrorBoundary>,
    );

    const fallback = screen.getByRole("alert", { name: "工作台故障恢复" });
    expect(fallback).toHaveTextContent("工作台暂时无法显示");
    expect(fallback).toHaveTextContent("render exploded");
    expect(onError).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    fireEvent.click(screen.getByRole("button", { name: "打开空白工作流" }));
    expect(onReload).toHaveBeenCalledOnce();
    expect(onOpenBlank).toHaveBeenCalledOnce();
  });

  it("keeps a compact panel failure local and retries it", () => {
    let shouldCrash = true;
    const onError = vi.fn(() => {
      shouldCrash = false;
    });
    render(
      <WorkbenchErrorBoundary area="画布" compact onError={onError}>
        <CrashOnce shouldCrash={() => shouldCrash}>画布已恢复</CrashOnce>
      </WorkbenchErrorBoundary>,
    );

    const fallback = screen.getByRole("alert", { name: "画布故障恢复" });
    expect(fallback).toHaveTextContent("其他区域仍可继续使用");
    expect(within(fallback).queryByRole("button", { name: "打开空白工作流" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试此区域" }));
    expect(screen.getByText("画布已恢复")).toBeInTheDocument();
  });

  it("automatically retries a failed area when its reset key changes", () => {
    let shouldCrash = true;
    const onError = vi.fn(() => {
      shouldCrash = false;
    });
    const { rerender } = render(
      <WorkbenchErrorBoundary area="运行结果" compact onError={onError} resetKey="run-1">
        <CrashOnce shouldCrash={() => shouldCrash}>运行结果已恢复</CrashOnce>
      </WorkbenchErrorBoundary>,
    );
    expect(screen.getByRole("alert", { name: "运行结果故障恢复" })).toBeInTheDocument();

    rerender(
      <WorkbenchErrorBoundary area="运行结果" compact onError={onError} resetKey="run-2">
        <CrashOnce shouldCrash={() => shouldCrash}>运行结果已恢复</CrashOnce>
      </WorkbenchErrorBoundary>,
    );

    expect(screen.getByText("运行结果已恢复")).toBeInTheDocument();
  });
});

function Crash({ message }: { message: string }): never {
  throw new Error(message);
}

class CrashOnce extends Component<{
  children: ReactNode;
  shouldCrash: () => boolean;
}> {
  render() {
    if (this.props.shouldCrash()) {
      throw new Error("temporary crash");
    }
    return this.props.children;
  }
}
