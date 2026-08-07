import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

// 未开启全局 cleanup 时，手动卸载避免多个弹窗实例叠加导致查询命中多个元素
afterEach(() => cleanup());

function dialogProps(overrides: Record<string, unknown> = {}) {
  return {
    confirmLabel: "确认执行",
    description: "这个操作不能撤销。",
    title: "确认操作",
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
}

describe("ConfirmDialog", () => {
  it("渲染标题与描述文案", () => {
    render(<ConfirmDialog {...dialogProps()} />);

    expect(screen.getByRole("dialog", { name: "确认操作" })).toBeInTheDocument();
    expect(screen.getByText("这个操作不能撤销。")).toBeInTheDocument();
  });

  it("点击确认按钮时回调 onConfirm", () => {
    const current = dialogProps();
    render(<ConfirmDialog {...current} />);

    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));

    expect(current.onConfirm).toHaveBeenCalledOnce();
    expect(current.onCancel).not.toHaveBeenCalled();
  });

  it("点击取消按钮时回调 onCancel", () => {
    const current = dialogProps();
    render(<ConfirmDialog {...current} />);

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(current.onCancel).toHaveBeenCalledOnce();
    expect(current.onConfirm).not.toHaveBeenCalled();
  });

  it("按下 Escape 时回调 onCancel", () => {
    const current = dialogProps();
    render(<ConfirmDialog {...current} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(current.onCancel).toHaveBeenCalledOnce();
  });

  it("busy 时按下 Escape 不关闭弹窗", () => {
    const current = dialogProps({ busy: true });
    render(<ConfirmDialog {...current} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(current.onCancel).not.toHaveBeenCalled();
  });

  it("busy 时点击遮罩不关闭弹窗", () => {
    const current = dialogProps({ busy: true });
    const { container } = render(<ConfirmDialog {...current} />);

    fireEvent.mouseDown(container.querySelector(".credential-manager-backdrop")!);

    expect(current.onCancel).not.toHaveBeenCalled();
  });

  it("破坏性确认使用 danger 按钮样式", () => {
    render(<ConfirmDialog {...dialogProps({ danger: true })} />);

    expect(screen.getByRole("button", { name: "确认执行" })).toHaveClass("danger-button");
  });

  it("默认确认使用 primary 按钮样式", () => {
    render(<ConfirmDialog {...dialogProps()} />);

    expect(screen.getByRole("button", { name: "确认执行" })).toHaveClass("primary-button");
  });

  it("busy 时禁用确认与取消按钮防止连点", () => {
    render(<ConfirmDialog {...dialogProps({ busy: true })} />);

    expect(screen.getByRole("button", { name: "确认执行" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  });
});
