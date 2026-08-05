import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, type CommandPaletteCommand } from "./CommandPalette";

afterEach(cleanup);

function makeCommands(): CommandPaletteCommand[] {
  return [
    { id: "save", group: "工作流", icon: "save", label: "保存工作流", shortcut: "Ctrl+S", onSelect: vi.fn() },
    { id: "run", group: "工作流", icon: "run", label: "运行工作流", onSelect: vi.fn() },
    {
      id: "undo",
      group: "编辑器",
      icon: "undo",
      label: "撤销",
      disabled: true,
      disabledReason: "没有可撤销的操作",
      onSelect: vi.fn(),
    },
  ];
}

describe("CommandPalette", () => {
  it("searches commands and executes the selected result", async () => {
    const commands = makeCommands();
    const onClose = vi.fn();
    render(<CommandPalette commands={commands} onClose={onClose} />);

    const search = screen.getByRole("combobox", { name: "搜索命令" });
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.change(search, { target: { value: "运行" } });
    expect(screen.getByRole("option", { name: "运行工作流" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(commands[1].onSelect).toHaveBeenCalledTimes(1);
  });

  it("navigates enabled commands and exposes disabled reasons", () => {
    const commands = makeCommands();
    render(<CommandPalette commands={commands} onClose={vi.fn()} />);
    const search = screen.getByRole("combobox", { name: "搜索命令" });

    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: "运行工作流" })).toHaveAttribute("aria-selected", "true");
    const disabled = screen.getByRole("option", { name: /撤销/ });
    expect(disabled).toHaveAttribute("aria-disabled", "true");
    expect(disabled).toHaveAttribute("title", "没有可撤销的操作");
    fireEvent.click(disabled);
    expect(commands[2].onSelect).not.toHaveBeenCalled();
  });

  it("shows an empty state when no command matches", () => {
    render(<CommandPalette commands={makeCommands()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "搜索命令" }), { target: { value: "不存在" } });
    expect(screen.getByText("没有匹配的命令")).toBeInTheDocument();
  });
});
