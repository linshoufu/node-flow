import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceResourceMenu } from "./WorkspaceResourceMenu";

describe("WorkspaceResourceMenu", () => {
  it("groups workspace resources, counts and package attention in one menu", () => {
    const onSelect = vi.fn();
    render(
      <WorkspaceResourceMenu
        credentialCount={2}
        environmentCount={1}
        nodeCount={5}
        packageAttentionCount={1}
        packageCount={3}
        variableCount={4}
        onSelect={onSelect}
      />,
    );

    const trigger = screen.getByRole("button", { name: /资源/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "资源管理" });
    expect(within(dialog).getByRole("button", { name: "凭据 2" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "项目变量 4" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "运行环境 1" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "节点包 3 1 个需处理" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "节点资产 5" })).toBeInTheDocument();
    expect(within(dialog).getByText("15 项")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "节点资产 5" }));
    expect(onSelect).toHaveBeenCalledWith("nodes");
    fireEvent.click(trigger);

    const reopenedDialog = screen.getByRole("dialog", { name: "资源管理" });
    fireEvent.click(within(reopenedDialog).getByRole("button", { name: "项目变量 4" }));
    expect(onSelect).toHaveBeenCalledWith("variables");
    expect(screen.queryByRole("dialog", { name: "资源管理" })).not.toBeInTheDocument();
  });

  it("closes with Escape and restores focus to the trigger", () => {
    render(
      <WorkspaceResourceMenu
        credentialCount={0}
        environmentCount={0}
        nodeCount={0}
        packageCount={1}
        variableCount={0}
        onSelect={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "资源" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "资源管理" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
