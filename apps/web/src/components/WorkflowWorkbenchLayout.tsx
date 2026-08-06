import { useEffect, useState, type ReactNode } from "react";
import {
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { WorkbenchErrorBoundary } from "./WorkbenchErrorBoundary";

export type WorkflowWorkbenchResetKeys = {
  canvas: string;
  inspector: string;
  nodeLibrary: string;
  runLog: string;
};

type WorkflowWorkbenchLayoutProps = {
  canvas: ReactNode;
  focusMode?: boolean;
  inspector: ReactNode;
  nodeLibrary: ReactNode;
  resetKeys: WorkflowWorkbenchResetKeys;
  runLog: ReactNode;
  onToggleFocusMode?: () => void;
};

const LAYOUT_STORAGE_KEY = "node-flow.workbench-layout";

type WorkbenchLayoutPreference = {
  inspectorCollapsed: boolean;
  paletteCollapsed: boolean;
};

export function WorkflowWorkbenchLayout({
  canvas,
  focusMode = false,
  inspector,
  nodeLibrary,
  resetKeys,
  runLog,
  onToggleFocusMode,
}: WorkflowWorkbenchLayoutProps) {
  const [paletteCollapsed, setPaletteCollapsed] = useState(
    () => readWorkbenchLayoutPreference().paletteCollapsed,
  );
  const [inspectorCollapsed, setInspectorCollapsed] = useState(
    () => readWorkbenchLayoutPreference().inspectorCollapsed,
  );

  useEffect(() => {
    writeWorkbenchLayoutPreference({ inspectorCollapsed, paletteCollapsed });
  }, [inspectorCollapsed, paletteCollapsed]);

  return (
    <main
      className="workspace-grid"
      data-focus={focusMode ? "true" : undefined}
      data-inspector-collapsed={inspectorCollapsed ? "true" : undefined}
      data-palette-collapsed={paletteCollapsed ? "true" : undefined}
    >
      <section
        aria-label="节点库区域"
        className="workspace-side workspace-side-left"
        data-collapsed={paletteCollapsed ? "true" : undefined}
      >
        {paletteCollapsed ? (
          <button
            aria-label="展开节点库"
            className="workspace-rail-toggle"
            title="展开节点库"
            type="button"
            onClick={() => setPaletteCollapsed(false)}
          >
            <PanelLeftOpen aria-hidden="true" size={16} strokeWidth={2.2} />
            <span className="workspace-rail-label">节点库</span>
          </button>
        ) : (
          <>
            <WorkbenchErrorBoundary
              area="节点库"
              compact
              fallbackClassName="panel palette-panel"
              resetKey={resetKeys.nodeLibrary}
            >
              {nodeLibrary}
            </WorkbenchErrorBoundary>
            <button
              aria-label="收起节点库"
              className="workspace-collapse-toggle workspace-collapse-toggle-left"
              title="收起节点库"
              type="button"
              onClick={() => setPaletteCollapsed(true)}
            >
              <PanelLeftClose aria-hidden="true" size={13} strokeWidth={2.4} />
            </button>
          </>
        )}
      </section>

      <section aria-label="画布区域" className="workspace-canvas-area">
        <WorkbenchErrorBoundary
          area="画布"
          compact
          fallbackClassName="canvas-shell"
          resetKey={resetKeys.canvas}
        >
          {canvas}
        </WorkbenchErrorBoundary>
        {onToggleFocusMode ? (
          <button
            aria-keyshortcuts="Escape"
            aria-label={focusMode ? "退出专注模式" : "进入专注模式"}
            aria-pressed={focusMode}
            className="canvas-focus-toggle"
            title={focusMode ? "退出专注模式（Esc）" : "进入专注模式：隐藏顶栏和侧边面板"}
            type="button"
            onClick={onToggleFocusMode}
          >
            {focusMode ? (
              <Minimize2 aria-hidden="true" size={14} strokeWidth={2.4} />
            ) : (
              <Maximize2 aria-hidden="true" size={14} strokeWidth={2.4} />
            )}
            <span>{focusMode ? "退出专注" : "专注模式"}</span>
          </button>
        ) : null}
      </section>

      <section
        aria-label="配置面板区域"
        className="workspace-side workspace-side-right"
        data-collapsed={inspectorCollapsed ? "true" : undefined}
      >
        {inspectorCollapsed ? (
          <button
            aria-label="展开配置面板"
            className="workspace-rail-toggle"
            title="展开配置面板"
            type="button"
            onClick={() => setInspectorCollapsed(false)}
          >
            <PanelRightOpen aria-hidden="true" size={16} strokeWidth={2.2} />
            <span className="workspace-rail-label">配置</span>
          </button>
        ) : (
          <>
            <WorkbenchErrorBoundary
              area="节点配置"
              compact
              fallbackClassName="panel config-panel"
              resetKey={resetKeys.inspector}
            >
              {inspector}
            </WorkbenchErrorBoundary>
            <button
              aria-label="收起配置面板"
              className="workspace-collapse-toggle workspace-collapse-toggle-right"
              title="收起配置面板"
              type="button"
              onClick={() => setInspectorCollapsed(true)}
            >
              <PanelRightClose aria-hidden="true" size={13} strokeWidth={2.4} />
            </button>
          </>
        )}
      </section>

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

function readWorkbenchLayoutPreference(): WorkbenchLayoutPreference {
  try {
    const rawValue = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!rawValue) {
      return { inspectorCollapsed: false, paletteCollapsed: false };
    }
    const parsedValue: unknown = JSON.parse(rawValue);
    if (!parsedValue || typeof parsedValue !== "object") {
      return { inspectorCollapsed: false, paletteCollapsed: false };
    }
    const candidate = parsedValue as Partial<WorkbenchLayoutPreference>;
    return {
      inspectorCollapsed: candidate.inspectorCollapsed === true,
      paletteCollapsed: candidate.paletteCollapsed === true,
    };
  } catch {
    return { inspectorCollapsed: false, paletteCollapsed: false };
  }
}

function writeWorkbenchLayoutPreference(preference: WorkbenchLayoutPreference): void {
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // Layout persistence is best-effort; storage may be unavailable in private browsing.
  }
}
