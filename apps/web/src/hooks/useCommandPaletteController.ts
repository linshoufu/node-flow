import { useCallback, useEffect, useState } from "react";

type UseCommandPaletteControllerOptions = {
  blocked?: boolean;
  onBeforeOpen?: () => void;
};

export function useCommandPaletteController({
  blocked = false,
  onBeforeOpen,
}: UseCommandPaletteControllerOptions = {}) {
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const closeCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(false);
  }, []);

  const openCommandPalette = useCallback(() => {
    if (blocked) {
      return false;
    }
    onBeforeOpen?.();
    setIsCommandPaletteOpen(true);
    return true;
  }, [blocked, onBeforeOpen]);

  useEffect(() => {
    if (blocked) {
      closeCommandPalette();
    }
  }, [blocked, closeCommandPalette]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") {
        return;
      }
      event.preventDefault();
      if (isCommandPaletteOpen) {
        closeCommandPalette();
      } else {
        openCommandPalette();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [closeCommandPalette, isCommandPaletteOpen, openCommandPalette]);

  return {
    closeCommandPalette,
    isCommandPaletteOpen,
    openCommandPalette,
  };
}
