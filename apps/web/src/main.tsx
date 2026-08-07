import React from "react";
import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "@mantine/core/styles.css";
import "./lib/domMatrixPolyfill";
import App from "./App";
import { WorkbenchErrorBoundary } from "./components/WorkbenchErrorBoundary";
import { NodeFlowMantineProvider } from "./components/NodeFlowMantineProvider";
import { applyTheme, readInitialTheme } from "./hooks/useTheme";
// styles.css 已按原顺序拆分为 styles/ 目录，导入顺序必须与原文件内区块顺序一致
import "./styles/tokens.css";
import "./styles/misc.css";
import "./styles/topbar.css";
import "./styles/dialogs.css";
import "./styles/notifications.css";
import "./styles/issues.css";
import "./styles/workspace.css";
import "./styles/panels.css";
import "./styles/run-panel.css";
import "./styles/overlays.css";
import "./styles/responsive.css";
import "./styles/run-events.css";
import "./styles/skeleton.css";
import "./styles/confirm-dialog.css";
import "./styles/lazy-skeleton.css";
import "./styles/editor.css";
import "./styles/modern.css";

applyTheme(readInitialTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <NodeFlowMantineProvider>
      <WorkbenchErrorBoundary>
        <App />
      </WorkbenchErrorBoundary>
    </NodeFlowMantineProvider>
  </React.StrictMode>
);
