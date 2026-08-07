import { useEffect, useState, type ReactNode } from "react";
import {
  createTheme,
  MantineProvider,
  type CSSVariablesResolver,
} from "@mantine/core";
import { readInitialTheme } from "../hooks/useTheme";

const theme = createTheme({
  primaryColor: "indigo",
  primaryShade: { light: 6, dark: 5 },
  defaultRadius: "md",
  cursorType: "pointer",
  fontFamily: 'Inter, "Microsoft YaHei", "PingFang SC", system-ui, sans-serif',
  fontFamilyMonospace: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  headings: {
    fontFamily: 'Inter, "Microsoft YaHei", "PingFang SC", system-ui, sans-serif',
    fontWeight: "700",
  },
  components: {
    Button: { defaultProps: { radius: "md" } },
    ActionIcon: { defaultProps: { radius: "md", variant: "subtle" } },
    TextInput: { defaultProps: { radius: "md" } },
    NumberInput: { defaultProps: { radius: "md" } },
    Select: { defaultProps: { radius: "md", searchable: false } },
    Textarea: { defaultProps: { radius: "md" } },
    SegmentedControl: { defaultProps: { radius: "md" } },
    Tooltip: { defaultProps: { openDelay: 350, withArrow: true } },
  },
});

const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    "--mantine-radius-default": "8px",
  },
  light: {
    "--mantine-color-body": "var(--color-bg-app)",
    "--mantine-color-text": "var(--color-text-primary)",
    "--mantine-color-dimmed": "var(--color-text-muted)",
    "--mantine-color-default": "var(--color-bg-surface)",
    "--mantine-color-default-hover": "var(--color-bg-raised)",
    "--mantine-color-default-color": "var(--color-text-primary)",
    "--mantine-color-default-border": "var(--color-border-default)",
  },
  dark: {
    "--mantine-color-body": "var(--color-bg-app)",
    "--mantine-color-text": "var(--color-text-primary)",
    "--mantine-color-dimmed": "var(--color-text-muted)",
    "--mantine-color-default": "var(--color-bg-surface)",
    "--mantine-color-default-hover": "var(--color-bg-raised)",
    "--mantine-color-default-color": "var(--color-text-primary)",
    "--mantine-color-default-border": "var(--color-border-default)",
  },
});

export function NodeFlowMantineProvider({ children }: { children: ReactNode }) {
  const [colorScheme, setColorScheme] = useState<"light" | "dark">(readInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    const syncColorScheme = () => setColorScheme(root.dataset.theme === "dark" ? "dark" : "light");
    syncColorScheme();
    const observer = new MutationObserver(syncColorScheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <MantineProvider
      cssVariablesResolver={cssVariablesResolver}
      deduplicateInlineStyles
      forceColorScheme={colorScheme}
      theme={theme}
    >
      {children}
    </MantineProvider>
  );
}
