import { Select } from "@/components/Select";
import { useEffect, useRef, useState } from "react";
import { Box, FolderKanban, History, LoaderCircle, Play, Save, Settings2 } from "lucide-react";
import type { RunRecord } from "@/types";
import { useWorkflowStore } from "@/store/workflow";
import { WorkflowWorkbenchLayout } from "@/components/WorkflowWorkbenchLayout";
import { FlowCanvas } from "@/components/FlowCanvas";
import { ConfigPanel } from "@/components/ConfigPanel";
import { RunsPage } from "@/components/RunsPage";
import { StatusBadge } from "@/components/RunDetails";
import { useRunMonitor } from "@/hooks/useRunMonitor";
import { useRunsStore } from "@/store/runs";
import { SaveFailureNotice } from "@/components/SaveFailureNotice";
import { WorkflowManager } from "@/components/WorkflowManager";
import { ResourcesPage } from "@/components/ResourcesPage";
import { Toaster, toast } from "@/components/Toaster";
import { RunParametersDialog } from "@/components/RunParametersDialog";
import { runParameterDeclaration } from "@/lib/runParameters";
import { WorkflowConfigurationDialog } from "@/components/WorkflowConfigurationDialog";

import { LibraryEditingToolbar } from "@/components/LibraryEditingToolbar";

type Page = "editor" | "manager" | "resources" | "runs";

export default function App() {
  const [page, setPage] = useState<Page>("editor");
  const loadWorkflows = useWorkflowStore((s) => s.loadWorkflows);
  const loadNodeTypes = useWorkflowStore((s) => s.loadNodeTypes);
  const selectWorkflow = useWorkflowStore((s) => s.selectWorkflow);
  const libraryEdit = useWorkflowStore((state) => state.libraryEdit);
  const workflow = useWorkflowStore((s) => s.workflow);
  const saveWorkflow = useWorkflowStore((s) => s.saveWorkflow);
  const runWorkflow = useWorkflowStore((s) => s.runWorkflow);
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const isSaving = useWorkflowStore((s) => s.isSaving);
  const saveError = useWorkflowStore((s) => s.saveError);
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);
  const setRunMode = useWorkflowStore((s) => s.setRunMode);
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const [parameterForm, setParameterForm] = useState<ReturnType<typeof runParameterDeclaration>>(null);
  const activeRun = useRunsStore((state) => state.activeRun);
  const runEvents = useRunsStore((state) => state.events);
  const monitoredWorkflow = useRunsStore((state) => state.workflowId);
  const runSnapshot = { run: monitoredWorkflow === workflow.id ? activeRun : null, events: monitoredWorkflow === workflow.id ? runEvents : [] };
  useRunMonitor(libraryEdit ? "" : workflow.id, page === "runs");
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
  const startRun = async (input?: Record<string, unknown>) => {
    if (!workflow.id || isCreatingRun) return;
    setIsCreatingRun(true);
    try {
      const run = await runWorkflow(undefined, input);
      if (!run) return;
      window.dispatchEvent(new CustomEvent<RunRecord>("nodeflow:run-created", { detail: run }));
      setParameterForm(null);
    } finally {
      setIsCreatingRun(false);
    }
  };
  const handleRun = async () => {
    try {
      if (isDirty) await saveWorkflow();
      const declaration = runParameterDeclaration(useWorkflowStore.getState().workflow);
      if (declaration?.fields.length) setParameterForm(declaration);
      else await startRun();
    } catch (error) { toast(error instanceof Error ? error.message : "无法运行工作流", "error"); }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-canvas text-text">
      {libraryEdit ? <LibraryEditingToolbar key={libraryEdit.asset.id} /> : <header className="app-topbar glass-island mx-3 mt-3 flex h-[52px] shrink-0 items-center gap-3 rounded-2xl px-4">
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
          {runSnapshot.run && <button type="button" onClick={() => setPage("runs")} className="run-feedback flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 hover:bg-raised" title="查看运行详情"><StatusBadge status={runSnapshot.run.status} /><span className="hidden text-[10px] text-muted xl:inline">查看详情</span></button>}
          <div className="flex-1" />
          <WorkflowConfigurationDialog />
          <button onClick={handleSave} aria-label="保存工作流" title="保存工作流" disabled={!isDirty || isSaving} className="inline-flex shrink-0 items-center gap-1.5 px-2.5 h-8 rounded-md text-xs text-text-secondary hover:text-text hover:bg-raised transition disabled:opacity-35"><Save size={14} /><span className="secondary-label">保存</span></button>
          <Select aria-label="运行方式" title="预演允许声明为只读的查询；写入操作生成计划。此选择会保存为工作流默认方式。" value={workflow.settings?.run_mode ?? "live"} onValueChange={(selectedValue) => setRunMode(selectedValue as "live" | "preview")} disabled={isCreatingRun || parameterForm !== null} className="h-8 w-[112px] shrink-0">
            <option value="preview">预演</option><option value="live">正式执行</option>
          </Select>
          <button onClick={handleRun} disabled={!workflow.id || isCreatingRun} className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition shadow-[0_4px_14px_hsl(212_93%_60%_/_0.2)] disabled:opacity-40">{isCreatingRun ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}{isCreatingRun ? "正在创建…" : "运行"}</button>
        </> : <><div className="flex-1" /><button onClick={() => setPage("editor")} className="px-3 h-8 rounded-md text-xs text-text-secondary hover:text-text hover:bg-raised">返回编辑器</button></>}

        <div className="w-px h-5 bg-border" />
        <nav className="flex items-center gap-1" aria-label="工作台导航">
          <button aria-label="运行记录" title="运行记录" onClick={() => setPage(page === "runs" ? "editor" : "runs")} className={`inline-flex items-center gap-1.5 text-xs px-2.5 h-8 rounded-md transition ${page === "runs" ? "bg-primary/12 text-primary" : "text-muted hover:text-text hover:bg-raised"}`}><History size={14} /><span className="secondary-label">运行记录</span></button>
          <button aria-label="工作流" title="工作流" onClick={() => setPage(page === "manager" ? "editor" : "manager")} className={`inline-flex items-center gap-1.5 text-xs px-2.5 h-8 rounded-md transition ${page === "manager" ? "bg-primary/12 text-primary" : "text-muted hover:text-text hover:bg-raised"}`}><FolderKanban size={14} /><span className="secondary-label">工作流</span></button>
          <button aria-label="资源" title="资源" onClick={() => setPage(page === "resources" ? "editor" : "resources")} className={`inline-flex items-center gap-1.5 text-xs px-2.5 h-8 rounded-md transition ${page === "resources" ? "bg-primary/12 text-primary" : "text-muted hover:text-text hover:bg-raised"}`}><Settings2 size={14} /><span className="secondary-label">资源</span></button>
        </nav>
      </header>}

      {page === "editor" && !libraryEdit && <SaveFailureNotice />}
      {page === "editor" ? <div className="contents" inert={Boolean(libraryEdit && isSaving)}><WorkflowWorkbenchLayout canvas={<FlowCanvas runSnapshot={runSnapshot} />} inspector={<ConfigPanel runSnapshot={runSnapshot} />} /></div> : page === "runs" ? <RunsPage /> : page === "manager" ? <div className="flex-1 overflow-hidden"><WorkflowManager onOpen={() => setPage("editor")} /></div> : <div className="flex-1 overflow-hidden"><ResourcesPage /></div>}
      <Toaster />
      {parameterForm && <RunParametersDialog fields={parameterForm.fields} inputPath={parameterForm.input_path} busy={isCreatingRun} onRun={startRun} onClose={() => setParameterForm(null)} />}
    </div>
  );
}
