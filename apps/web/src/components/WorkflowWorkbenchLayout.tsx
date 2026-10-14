import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanelRight, Plus } from "lucide-react";
import { useWorkflowStore } from "@/store/workflow";
import { NodePalette } from "./NodePalette";

export function WorkflowWorkbenchLayout({ canvas, inspector }: { canvas: ReactNode; inspector: ReactNode }) {
  const selectedNodeId = useWorkflowStore((state) => state.selectedNodeId);
  const workflowId = useWorkflowStore((state) => state.workflow.id);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(Boolean(selectedNodeId));
  const libraryButton = useRef<HTMLButtonElement>(null);
  const closeLibrary = () => { setLibraryOpen(false); libraryButton.current?.focus(); };
  useEffect(() => { setInspectorOpen(Boolean(selectedNodeId)); }, [selectedNodeId]);
  useEffect(() => { setLibraryOpen(false); }, [workflowId]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setLibraryOpen(false); setInspectorOpen(false); }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  return <div className="workbench-layout relative flex min-h-0 flex-1 px-3 pb-3 pt-2">
    <main aria-label="工作流画布" className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-border/50 bg-canvas">
      {canvas}
      <div className="glass-island absolute right-3 top-3 z-20 flex gap-1 rounded-xl p-1">
        <button ref={libraryButton} type="button" onClick={() => { if (!libraryOpen) setInspectorOpen(false); setLibraryOpen((open) => !open); }} aria-expanded={libraryOpen} aria-label={libraryOpen ? "收起节点库" : "展开节点库"} title="添加节点" className={`flex items-center gap-1.5 rounded-lg px-2.5 text-xs ${libraryOpen ? "bg-primary/15 text-primary" : "text-text-secondary hover:bg-raised hover:text-text"}`}><Plus size={16} />添加节点</button>
        <button type="button" disabled={!selectedNodeId} onClick={() => { setLibraryOpen(false); setInspectorOpen((open) => !open); }} aria-pressed={Boolean(selectedNodeId) && inspectorOpen} aria-label={inspectorOpen && selectedNodeId ? "收起配置面板" : "展开配置面板"} title="节点配置" className={`island-button ${inspectorOpen && selectedNodeId ? "active" : ""}`}><PanelRight size={16} /></button>
      </div>
      {libraryOpen && <aside aria-label="节点库面板" className="editor-overlay library workbench-surface absolute bottom-3 left-3 top-16 z-30 flex w-[280px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl shadow-2xl"><NodePalette onAdded={closeLibrary} onClose={closeLibrary} /></aside>}
      {selectedNodeId && inspectorOpen && <aside aria-label="节点配置面板" className="editor-overlay inspector workbench-surface absolute bottom-3 right-3 top-16 z-30 flex w-[320px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl shadow-2xl">{inspector}</aside>}
    </main>
  </div>;
}
