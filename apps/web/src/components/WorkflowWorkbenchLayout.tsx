import { useCallback, useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

type Props = {
  nodeLibrary: ReactNode;
  canvas: ReactNode;
  inspector: ReactNode;
  runLog: ReactNode;
};

type PaneKey = "library" | "inspector" | "run";
type PaneSizes = Record<PaneKey, number>;

const DEFAULT_SIZES: PaneSizes = { library: 272, inspector: 320, run: 360 };
const STORAGE_KEY = "node-flow.workbench-pane-sizes";

function readPaneSizes(): PaneSizes {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<PaneSizes>;
    return {
      library: clamp("library", stored.library ?? DEFAULT_SIZES.library),
      inspector: clamp("inspector", stored.inspector ?? DEFAULT_SIZES.inspector),
      run: clamp("run", stored.run ?? DEFAULT_SIZES.run),
    };
  } catch {
    return DEFAULT_SIZES;
  }
}

function clamp(pane: PaneKey, value: number) {
  const bounds: Record<PaneKey, [number, number]> = {
    library: [208, 420],
    inspector: [280, 560],
    run: [220, Math.max(300, window.innerHeight - 190)],
  };
  const [min, max] = bounds[pane];
  return Math.round(Math.min(max, Math.max(min, value)));
}

export function WorkflowWorkbenchLayout({ nodeLibrary, canvas, inspector, runLog }: Props) {
  const [sizes, setSizes] = useState<PaneSizes>(readPaneSizes);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
  }, [sizes]);

  const adjust = useCallback((pane: PaneKey, delta: number) => {
    setSizes((current) => ({ ...current, [pane]: clamp(pane, current[pane] + delta) }));
  }, []);

  const beginResize = useCallback((pane: PaneKey, direction: 1 | -1, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startPosition = pane === "run" ? event.clientY : event.clientX;
    const startSize = sizes[pane];

    const move = (moveEvent: globalThis.MouseEvent) => {
      const position = pane === "run" ? moveEvent.clientY : moveEvent.clientX;
      setSizes((current) => ({ ...current, [pane]: clamp(pane, startSize + (position - startPosition) * direction) }));
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  }, [sizes]);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside style={{ width: sizes.library }} className="shrink-0 border-r border-border/80 bg-surface flex flex-col">{nodeLibrary}</aside>
        <ResizeHandle ariaLabel="调整节点库宽度" orientation="vertical" value={sizes.library} onMouseDown={(event) => beginResize("library", 1, event)} onKeyDown={(event) => handleKey(event, (delta) => adjust("library", delta))} />
        <main className="min-w-0 flex-1 relative overflow-hidden bg-canvas">{canvas}</main>
        <ResizeHandle ariaLabel="调整配置面板宽度" orientation="vertical" value={sizes.inspector} onMouseDown={(event) => beginResize("inspector", -1, event)} onKeyDown={(event) => handleKey(event, (delta) => adjust("inspector", -delta))} />
        <aside style={{ width: sizes.inspector }} className="shrink-0 border-l border-border/80 bg-surface flex flex-col overflow-hidden">{inspector}</aside>
      </div>

      <ResizeHandle ariaLabel="调整运行结果高度" orientation="horizontal" value={sizes.run} onMouseDown={(event) => beginResize("run", -1, event)} onKeyDown={(event) => handleKey(event, (delta) => adjust("run", -delta))} />
      <div style={{ height: sizes.run }} className="shrink-0 min-h-0 overflow-hidden border-t border-border/80 bg-surface">{runLog}</div>
    </div>
  );
}

function handleKey(event: KeyboardEvent<HTMLDivElement>, adjust: (delta: number) => void) {
  const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 24 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -24 : 0;
  if (!delta) return;
  event.preventDefault();
  adjust(delta);
}

function ResizeHandle({ ariaLabel, onKeyDown, onMouseDown, orientation, value }: { ariaLabel: string; onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void; onMouseDown: (event: MouseEvent<HTMLDivElement>) => void; orientation: "vertical" | "horizontal"; value: number }) {
  const vertical = orientation === "vertical";
  return <div role="separator" tabIndex={0} aria-label={ariaLabel} aria-orientation={orientation} aria-valuenow={value} onMouseDown={onMouseDown} onKeyDown={onKeyDown} title={`${ariaLabel}（可拖动）`} className={`group relative z-20 shrink-0 touch-none outline-none ${vertical ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize"}`}><span className={`absolute bg-border transition-colors group-hover:bg-primary group-focus:bg-primary ${vertical ? "inset-y-0 left-1/2 w-px -translate-x-1/2" : "inset-x-0 top-1/2 h-px -translate-y-1/2"}`} /></div>;
}
