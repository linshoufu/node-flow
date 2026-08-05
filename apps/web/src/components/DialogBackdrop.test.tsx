import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DialogBackdrop } from "./DialogBackdrop";

describe("DialogBackdrop", () => {
  it("focuses the dialog, closes from Escape or the backdrop, and restores page state", async () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { container, unmount } = render(
      <DialogBackdrop onClose={onClose}>
        <section aria-label="示例弹层" role="dialog">
          <button type="button">弹层操作</button>
          <button type="button">第二项操作</button>
        </section>
      </DialogBackdrop>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "弹层操作" })).toHaveFocus());
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "第二项操作" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "弹层操作" })).toHaveFocus();
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "示例弹层" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(container.firstElementChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);

    unmount();
    expect(document.body.style.overflow).toBe("");
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
