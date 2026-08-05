import React from "react";
import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./lib/domMatrixPolyfill";
import App from "./App";
import { WorkbenchErrorBoundary } from "./components/WorkbenchErrorBoundary";
import { applyTheme, readInitialTheme } from "./hooks/useTheme";
import "./styles.css";

applyTheme(readInitialTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WorkbenchErrorBoundary>
      <App />
    </WorkbenchErrorBoundary>
  </React.StrictMode>
);
