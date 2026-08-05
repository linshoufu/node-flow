import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowConflictDialog } from "./WorkflowConflictDialog";

afterEach(cleanup);

describe("WorkflowConflictDialog", () => {
  it("offers safe reload and copy actions for a save conflict", () => {
    const onClose = vi.fn();
    const onReload = vi.fn();
    const onSaveCopy = vi.fn();
    render(
      <WorkflowConflictDialog
        action="save"
        busy={false}
        currentVersion={4}
        expectedVersion={3}
        onClose={onClose}
        onReload={onReload}
        onSaveCopy={onSaveCopy}
      />,
    );

    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText("v4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "另存为副本" }));
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    fireEvent.click(screen.getByRole("button", { name: "稍后处理" }));

    expect(onSaveCopy).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("only offers reload for non-save mutations", () => {
    render(
      <WorkflowConflictDialog
        action="activation"
        busy={false}
        currentVersion={8}
        expectedVersion={7}
        onClose={vi.fn()}
        onReload={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "另存为副本" })).not.toBeInTheDocument();
    expect(screen.getByText("重新加载后可以基于服务器上的最新版本继续操作。")).toBeInTheDocument();
  });
});
