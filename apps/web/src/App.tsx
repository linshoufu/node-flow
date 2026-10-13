import { useEffect, useState } from "react";
import { Box, FolderKanban, LoaderCircle, Play, Save, Settings2 } from "lucide-react";
import type { RunRecord } from "@/types";
import { useWorkflowStore } from "@/store/workflow";
import { WorkflowWorkbenchLayout } from "@/components/WorkflowWorkbenchLayout";
import { NodePalette } from "@/components/NodePalette";
import { FlowCanvas } from "@/components/FlowCanvas";
import { ConfigPanel } from "@/components/ConfigPanel";
import { RunPanel } from "@/components/RunPanel";
import { WorkflowManager } from "@/components/WorkflowManager";
import { ResourcesPage } from "@/components/ResourcesPage";
import { Toaster } from "@/components/Toaster";

type Page = "editor" | "manager" | "resources";

export default function App() {
  const [page, setPage] = useState<Page>("editor");
  const loadWorkflows = useWorkflowStore((s) => s.loadWorkflows);
  const loadNodeTypes = useWorkflowStore((s) => s.loadNodeTypes);
  const selectWorkflow = useWorkflowStore((s) => s.selectWorkflow);
  const workflow = useWorkflowStore((s) => s.workflow);
  const saveWorkflow = useWorkflowStore((s) => s.saveWorkflow);
  const runWorkflow = useWorkflowStore((s) => s.runWorkflow);
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const isSaving = useWorkflowStore((s) => s.isSaving);
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const [latestRun, setLatestRun] = useState<RunRecord | null>(null);

  useEffect(() => {
    void (async () => {
      await Promise.all([loadWorkflows(), loadNodeTypes()]);
      const { workflow: current, workflows } = useWorkflowStore.getState();
      if (!current.id && workflows.length > 0) await selectWorkflow(workflows[0].id);
    })();
  }, [loadWorkflows, loadNodeTypes, selectWorkflow]);

  const handleSave = async () => { try { await saveWorkflow(); } catch { /* store reports failure */ } };
  const handleRun = async () => {
    if (!workflow.id || isCreatingRun) return;
    setIsCreatingRun(true);
    try {
      const run = await runWorkflow();
      if (!run) return;
      setLatestRun(run);
      window.dispatchEvent(new CustomEvent<RunRecord>("nodeflow:run-created", { detail: run }));
    } finally {
      setIsCreatingRun(false);
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-canvas text-text">
      <header className="h-[52px] shrink-0 flex items-center gap-3 px-4 border-b border-border/80 bg-surface">
        <button onClick={() => setPage("editor")} className="flex items-center gap-2.5 font-semibold text-sm text-white select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-white shadow-[0_5px_16px_hsl(212_93%_60%_/_0.25)]"><Box size={15} strokeWidth={2.4} /></span>
          <span>Node Flow</span>
        </button>
        <div className="w-px h-5 bg-border" />

        {page === "editor" ? <>
          <div className="min-w-0 flex items-center gap-2">
            <input aria-label="工作流名称" value={workflow.name} onChange={(e) => setWorkflowName(e.target.value)} className="bg-transparent text-sm font-medium px-2 py-1 rounded-md hover:bg-raised focus:outline-none focus:ring-2 focus:ring-primary/30 w-52" />
            <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted whitespace-nowrap">
              <span className={`h-1.5 w-1.5 rounded-full ${isDirty ? "bg-warning" : "bg-success"}`} />
              {isSaving ? "正在保存" : isDirty ? "未保存" : "已保存"}
            </span>
          </div>
          {latestRun && <p className="hidden min-w-0 max-w-[260px] truncate text-[11px] text-primary lg:block" title={`运行 #${latestRun.id} 已创建，请在下方查看状态`}>运行 #{latestRun.id.slice(0, 8)} 已创建</p>}
          <div className="flex-1" />
          <button onClick={handleSave} disabled={!isDirty || isSaving} className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs text-text-secondary hover:text-text hover:bg-raised transition disabled:opacity-35"><Save size={14} />保存</button>
          <button onClick={handleRun} disabled={!workflow.id || isCreatingRun} className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition shadow-[0_4px_14px_hsl(212_93%_60%_/_0.2)] disabled:opacity-40">{isCreatingRun ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}{isCreatingRun ? "正在创建…" : "运行"}</button>
        </> : <><div className="flex-1" /><button onClick={() => setPage("editor")} className="px-3 h-8 rounded-md text-xs text-text-secondary hover:text-text hover:bg-raised">返回编辑器</button></>}

        <div className="w-px h-5 bg-border" />
        <nav className="flex items-center gap-1" aria-label="工作台导航">
          <button onClick={() => setPage(page === "manager" ? "editor" : "manager")} className={`inline-flex items-center gap-1.5 text-xs px-2.5 h-8 rounded-md transition ${page === "manager" ? "bg-primary/12 text-primary" : "text-muted hover:text-text hover:bg-raised"}`}><FolderKanban size={14} />工作流</button>
          <button onClick={() => setPage(page === "resources" ? "editor" : "resources")} className={`inline-flex items-center gap-1.5 text-xs px-2.5 h-8 rounded-md transition ${page === "resources" ? "bg-primary/12 text-primary" : "text-muted hover:text-text hover:bg-raised"}`}><Settings2 size={14} />资源</button>
        </nav>
      </header>

      {page === "editor" ? <WorkflowWorkbenchLayout nodeLibrary={<NodePalette />} canvas={<FlowCanvas />} inspector={<ConfigPanel />} runLog={<RunPanel />} /> : page === "manager" ? <div className="flex-1 overflow-hidden"><WorkflowManager onOpen={() => setPage("editor")} /></div> : <div className="flex-1 overflow-hidden"><ResourcesPage /></div>}
      <Toaster />
    </div>
  );
}
