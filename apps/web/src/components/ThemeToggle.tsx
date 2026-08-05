import { Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "切换到浅色主题" : "切换到深色主题";
  return (
    <button aria-label={label} className="icon-button" title={label} type="button" onClick={toggleTheme}>
      {isDark ? <Sun aria-hidden="true" size={16} strokeWidth={2.1} /> : <Moon aria-hidden="true" size={16} strokeWidth={2.1} />}
    </button>
  );
}
