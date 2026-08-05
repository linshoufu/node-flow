import { useCallback, useEffect, useState } from "react";

export type AppTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "node-flow-theme";

export function readInitialTheme(): AppTheme {
  if (typeof window === "undefined") {
    return "light";
  }
  const stored = window.localStorage?.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
  // 部分 Chromium 版本在 data-theme 属性切换时不会自动重算依赖继承变量的样式，
  // 通过一次强制样式重算保证主题切换即时生效。
  if (typeof window !== "undefined" && typeof document.body !== "undefined") {
    const { display } = document.body.style;
    document.body.style.display = "none";
    void document.body.offsetHeight;
    document.body.style.display = display;
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<AppTheme>(readInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage?.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggleTheme };
}
