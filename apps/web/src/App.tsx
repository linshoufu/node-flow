import { useEffect, useRef, useState } from "react";
import { Box, FolderKanban, LoaderCircle, Play, Save, Settings2 } from "lucide-react";
import type { RunRecord } from "@/types";
import { useWorkflowStore } from "@/store/workflow";
import { WorkflowWorkbenchLayout } from "@/components/WorkflowWorkbenchLayout";
import { NodePalette } from "@/components/NodePalette";
import { FlowCanvas } from "@/components/FlowCanvas";
import { ConfigPanel } from "@/components/ConfigPanel";
import { RunPanel } from "@/components/RunPanel";
import { SaveFailureNotice } from "@/components/SaveFailureNotice";
import { WorkflowManager } from "@/components/WorkflowManager";
import { ResourcesPage } from "@/components/ResourcesPage";
import { Toaster, toast } from "@/components/Toaster";

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
  const saveError = useWorkflowStore((s) => s.saveError);
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const [latestRun, setLatestRun] = useState<RunRecord | null>(null);
  const reportedFailure = useRef<typeof saveError>(null);

  useEffect(() => {
    if (!saveError || reportedFailure.current === saveError) return;
    reportedFailure.current = saveError;
    toast(saveError.message, "error");
  }, [saveError]);

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
      <header className="app-topbar glass-island mx-3 mt-3 flex h-[52px] shrink-0 items-center gap-3 rounded-2xl px-4">
        <button aria-label="回到编辑器" title="Node Flow" onClick={() => setPage("editor")} className="flex shrink-0 items-center gap-2.5 font-semibold text-sm text-white select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-white shadow-[0_5px_16px_hsl(212_93%_60%_/_0.25)]"><Box size={15} strokeWidth={2.4} /></span>
          <span className="brand-label">Node Flow</span>
        </button>
        <div className="w-px h-5 bg-border" />

        {page === "editor" ? <>
          <div className="workflow-heading min-w-0 flex items-center gap-2">
            <input aria-label="工作流名称" value={workflow.name} onChange={(e) => setWorkflowName(e.target.value)} className="min-w-0 bg-transparent text-sm font-medium px-2 py-1 rounded-md hover:bg-raised focus:outline-none focus:ring-2 focus:ring-primary/30 w-52" />
            <span className={`save-state hidden sm:flex items-center gap-1.5 text-[11px] whitespace-nowrap ${saveError ? "text-danger" : "text-muted"}`} title={saveError?.message}>
              <span className={`h-1.5 w-1.5 rounded-full ${saveError ? "bg-danger" : isDirty ? "bg-warning" : "bg-success"}`} />
              {saveError ? "保存失败" : isSaving ? "正在保存" : isDirty ? "未保存" : "已保存"}
            </span>
          </div>
          {latestRun?.workflow_id === workflow.id && <p className="run-feedback hidden min-w-0 max-w-[180px] truncate text-[11px] text-primary xl:block" title={`运行 #${latestRun.id} 已创建，请在下方查看状态`}>运行 #{latestRun.id.replace(/^run_/, "").slice(0, 6)} 已创建</p>}
          <div className="flex-1" />
          <button onClick={handleSave} aria-label="保存工作流" title="保存工作流" disabled={!isDirty || isSaving} className="inline-flex shrink-0 items-center gap-1.5 px-2.5 h-8 rounded-md text-xs text-text-secondary hover:text-text hover:bg-raised transition disabled:opacity-35"><Save size={14} /><span className="secondary-label">保存</span></button>
          <button onClick={handleRun} disabled={!workflow.id || isCreatingRun} className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition shadow-[0_4px_14px_hsl(212_93%_60%_/_0.2)] disabled:opacity-40">{isCreatingRun ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}{isCreatingRun ? "正在创建…" : "运行"}</button>
        </> : <><div className="flex-1" /><button onClick={() => setPage("editor")} className="px-3 h-8 rounded-md text-xs text-text-secondary hover:text-text hover:bg-raised">返回编辑器</button></>}

        <div className="w-px h-5 bg-border" />
        <nav className="flex items-center gap-1" aria-label="工作台导航">
          <button aria-label="工作流" title="工作流" onClick={() => setPage(page === "manager" ? "editor" : "manager")} className={`inline-flex items-center gap-1.5 text-xs px-2.5 h-8 rounded-md transition ${page === "manager" ? "bg-primary/12 text-primary" : "text-muted hover:text-text hover:bg-raised"}`}><FolderKanban size={14} /><span className="secondary-label">工作流</span></button>
          <button aria-label="资源" title="资源" onClick={() => setPage(page === "resources" ? "editor" : "resources")} className={`inline-flex items-center gap-1.5 text-xs px-2.5 h-8 rounded-md transition ${page === "resources" ? "bg-primary/12 text-primary" : "text-muted hover:text-text hover:bg-raised"}`}><Settings2 size={14} /><span className="secondary-label">资源</span></button>
        </nav>
      </header>

      {page === "editor" && <SaveFailureNotice />}
      {page === "editor" ? <WorkflowWorkbenchLayout nodeLibrary={<NodePalette />} canvas={<FlowCanvas />} inspector={<ConfigPanel />} runLog={(props) => <RunPanel {...props} />} /> : page === "manager" ? <div className="flex-1 overflow-hidden"><WorkflowManager onOpen={() => setPage("editor")} /></div> : <div className="flex-1 overflow-hidden"><ResourcesPage /></div>}
      <Toaster />
    </div>
  );
}
