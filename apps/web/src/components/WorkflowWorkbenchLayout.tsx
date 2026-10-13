import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { PanelLeft, PanelRight } from "lucide-react";
import { useWorkflowStore } from "@/store/workflow";

type PaneKey = "library" | "inspector" | "run";
type PaneSizes = Record<PaneKey, number>;
type Props = { nodeLibrary: ReactNode; canvas: ReactNode; inspector: ReactNode; runLog: (props: { expanded: boolean; onToggle: () => void }) => ReactNode };
const DEFAULT_SIZES: PaneSizes = { library: 224, inspector: 288, run: 360 };
const SIZE_KEY = "node-flow.workbench-pane-sizes";
const PANEL_KEY = "node-flow.workbench-panels";
function read<T>(key: string, fallback: T): T { try { return { ...fallback, ...JSON.parse(window.localStorage.getItem(key) ?? "{}") }; } catch { return fallback; } }
function bounds(pane: PaneKey, height = window.innerHeight): [number, number] { return pane === "library" ? [208, 360] : pane === "inspector" ? [264, 420] : [260, Math.max(260, height * 0.48)]; }
function clamp(pane: PaneKey, value: number, height = window.innerHeight) { const [min, max] = bounds(pane, height); return Math.round(Math.min(max, Math.max(min, Number.isFinite(value) ? value : DEFAULT_SIZES[pane]))); }

export function WorkflowWorkbenchLayout({ nodeLibrary, canvas, inspector, runLog }: Props) {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const workflowId = useWorkflowStore((s) => s.workflow.id);
  const [sizes, setSizes] = useState(() => read(SIZE_KEY, DEFAULT_SIZES));
  const [panels, setPanels] = useState(() => read(PANEL_KEY, { library: true, inspector: false, run: false }));
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);
  const inspectorOpen = Boolean(selectedNodeId) && panels.inspector;
  const cleanupResize = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupResize.current?.(), []);
  useEffect(() => { try { window.localStorage.setItem(SIZE_KEY, JSON.stringify(sizes)); window.localStorage.setItem(PANEL_KEY, JSON.stringify(panels)); } catch { /* Restricted storage still supports resizing. */ } }, [sizes, panels]);
  useEffect(() => { setPanels((current) => ({ ...current, inspector: Boolean(selectedNodeId) })); }, [selectedNodeId]);
  useEffect(() => { const resize = () => setViewportHeight(window.innerHeight); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
  useEffect(() => { const expand = (event: Event) => { if ((event as CustomEvent<{ workflow_id: string }>).detail?.workflow_id === workflowId) setPanels((current) => ({ ...current, run: true })); }; window.addEventListener("nodeflow:run-created", expand); return () => window.removeEventListener("nodeflow:run-created", expand); }, [workflowId]);
  const adjust = useCallback((pane: PaneKey, delta: number) => setSizes((current) => ({ ...current, [pane]: clamp(pane, clamp(pane, current[pane]) + delta) })), []);
  const beginResize = useCallback((pane: PaneKey, direction: 1 | -1, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault(); cleanupResize.current?.();
    const start = pane === "run" ? event.clientY : event.clientX;
    const initial = clamp(pane, sizes[pane]);
    const move = (next: globalThis.MouseEvent) => setSizes((current) => ({ ...current, [pane]: clamp(pane, initial + ((pane === "run" ? next.clientY : next.clientX) - start) * direction) }));
    const stop = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", stop); cleanupResize.current = null; };
    cleanupResize.current = stop; window.addEventListener("mousemove", move); window.addEventListener("mouseup", stop);
  }, [sizes]);
  const handle = (pane: PaneKey, label: string, direction: 1 | -1) => {
    const [min, max] = bounds(pane, viewportHeight);
    return <div role="separator" tabIndex={0} aria-label={label} aria-orientation={pane === "run" ? "horizontal" : "vertical"} aria-valuenow={clamp(pane, sizes[pane])} aria-valuemin={min} aria-valuemax={Math.round(max)} onMouseDown={(event) => beginResize(pane, direction, event)} onKeyDown={(event: KeyboardEvent) => {
      const delta = ["ArrowRight", "ArrowDown"].includes(event.key) ? 24 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -24 : 0;
      if (delta) { event.preventDefault(); adjust(pane, delta * direction); }
    }} className={`workbench-resizer ${pane === "run" ? "horizontal" : "vertical"}`} title={`${label}（拖动或方向键）`} />;
  };
  return <div className="workbench-layout flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2">
    <div className="relative flex min-h-0 flex-1">
      {panels.library && <><aside aria-label="节点库面板" style={{ width: clamp("library", sizes.library) }} className="workbench-pane library workbench-surface flex shrink-0 flex-col overflow-hidden rounded-2xl">{nodeLibrary}</aside>{handle("library", "调整节点库宽度", 1)}</>}
      <main aria-label="工作流画布" className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-border/50 bg-canvas">
        {canvas}
        <div className="glass-island absolute right-3 top-3 z-20 flex gap-1 rounded-xl p-1">
          <button onClick={() => setPanels((current) => ({ ...current, library: !current.library }))} aria-pressed={panels.library} aria-label={panels.library ? "收起节点库" : "展开节点库"} title={panels.library ? "收起节点库" : "展开节点库"} className={`island-button ${panels.library ? "active" : ""}`}><PanelLeft size={16} /></button>
          <button disabled={!selectedNodeId} onClick={() => setPanels((current) => ({ ...current, inspector: !current.inspector }))} aria-pressed={inspectorOpen} aria-label={inspectorOpen ? "收起配置面板" : "展开配置面板"} title={!selectedNodeId ? "选择节点后查看配置" : inspectorOpen ? "收起配置面板" : "展开配置面板"} className={`island-button ${inspectorOpen ? "active" : ""}`}><PanelRight size={16} /></button>
        </div>
      </main>
      {inspectorOpen && <>{handle("inspector", "调整配置面板宽度", -1)}<aside aria-label="节点配置面板" style={{ width: clamp("inspector", sizes.inspector) }} className="workbench-pane inspector workbench-surface flex shrink-0 flex-col overflow-hidden rounded-2xl">{inspector}</aside></>}
    </div>
    {panels.run ? handle("run", "调整运行结果高度", -1) : <div className="h-2 shrink-0" />}
    <div style={{ height: panels.run ? clamp("run", sizes.run, viewportHeight) : 44 }} className="workbench-surface min-h-0 shrink-0 overflow-hidden rounded-2xl">{runLog({ expanded: panels.run, onToggle: () => setPanels((current) => ({ ...current, run: !current.run })) })}</div>
  </div>;
}
