import type { ReactNode } from "react";
import { WorkbenchErrorBoundary } from "./WorkbenchErrorBoundary";

export type WorkflowWorkbenchResetKeys = {
  canvas: string;
  inspector: string;
  nodeLibrary: string;
  runLog: string;
};

type WorkflowWorkbenchLayoutProps = {
  canvas: ReactNode;
  inspector: ReactNode;
  nodeLibrary: ReactNode;
  resetKeys: WorkflowWorkbenchResetKeys;
  runLog: ReactNode;
};

export function WorkflowWorkbenchLayout({
  canvas,
  inspector,
  nodeLibrary,
  resetKeys,
  runLog,
}: WorkflowWorkbenchLayoutProps) {
  return (
    <main className="workspace-grid">
      <WorkbenchErrorBoundary
        area="节点库"
        compact
        fallbackClassName="panel palette-panel"
        resetKey={resetKeys.nodeLibrary}
      >
        {nodeLibrary}
      </WorkbenchErrorBoundary>
      <WorkbenchErrorBoundary
        area="画布"
        compact
        fallbackClassName="canvas-shell"
        resetKey={resetKeys.canvas}
      >
        {canvas}
      </WorkbenchErrorBoundary>
      <WorkbenchErrorBoundary
        area="节点配置"
        compact
        fallbackClassName="panel config-panel"
        resetKey={resetKeys.inspector}
      >
        {inspector}
      </WorkbenchErrorBoundary>
      <WorkbenchErrorBoundary
        area="运行结果"
        compact
        fallbackClassName="run-drawer"
        resetKey={resetKeys.runLog}
      >
        {runLog}
      </WorkbenchErrorBoundary>
    </main>
  );
}
