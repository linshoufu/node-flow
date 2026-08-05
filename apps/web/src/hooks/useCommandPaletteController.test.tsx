import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCommandPaletteController } from "./useCommandPaletteController";

describe("useCommandPaletteController", () => {
  it("opens and closes from the public controller", () => {
    const onBeforeOpen = vi.fn();
    const { result } = renderHook(() => useCommandPaletteController({ onBeforeOpen }));

    act(() => expect(result.current.openCommandPalette()).toBe(true));
    expect(result.current.isCommandPaletteOpen).toBe(true);
    expect(onBeforeOpen).toHaveBeenCalledTimes(1);
    act(() => result.current.closeCommandPalette());
    expect(result.current.isCommandPaletteOpen).toBe(false);
  });

  it("toggles with Ctrl or Command plus K", () => {
    const { result } = renderHook(() => useCommandPaletteController());
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true })));
    expect(result.current.isCommandPaletteOpen).toBe(true);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "K", metaKey: true })));
    expect(result.current.isCommandPaletteOpen).toBe(false);
  });

  it("prevents the browser shortcut but does not open above another blocking dialog", () => {
    const onBeforeOpen = vi.fn();
    const { result } = renderHook(() => useCommandPaletteController({ blocked: true, onBeforeOpen }));
    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true });
    act(() => window.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(result.current.isCommandPaletteOpen).toBe(false);
    expect(result.current.openCommandPalette()).toBe(false);
    expect(onBeforeOpen).not.toHaveBeenCalled();
  });

  it("closes when another blocking dialog becomes active", () => {
    const { result, rerender } = renderHook(
      ({ blocked }) => useCommandPaletteController({ blocked }),
      { initialProps: { blocked: false } },
    );
    act(() => result.current.openCommandPalette());
    expect(result.current.isCommandPaletteOpen).toBe(true);

    rerender({ blocked: true });
    expect(result.current.isCommandPaletteOpen).toBe(false);
  });
});
