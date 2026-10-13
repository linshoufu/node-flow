import { useEffect, useState, useCallback } from "react";
import { FolderOpen, Import, Plus } from "lucide-react";
import { useWorkflowStore } from "@/store/workflow";
import { apiClient } from "@/api/client";
import type { WorkflowDocument } from "@/types";
import { toast } from "./Toaster";

const RUN_STATUS_LABELS: Record<string, string> = { queued: "排队中", running: "运行中", succeeded: "已完成", failed: "失败", cancelled: "已取消" };

export function WorkflowManager({ onOpen }: { onOpen?: () => void }) {
  const workflows = useWorkflowStore((s) => s.workflows);
  const loadWorkflows = useWorkflowStore((s) => s.loadWorkflows);
  const selectWorkflow = useWorkflowStore((s) => s.selectWorkflow);
  const saveWorkflow = useWorkflowStore((s) => s.saveWorkflow);
  const setNodes = useWorkflowStore((s) => s.setNodes);
  const setEdges = useWorkflowStore((s) => s.setEdges);
  const [importing, setImporting] = useState(false);

  const handleSelect = useCallback(async (id: string) => {
    await selectWorkflow(id);
    onOpen?.();
    toast("已加载工作流", "success");
  }, [onOpen, selectWorkflow]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`确认删除 "${name}"？此操作不可撤销。`)) return;
    try {
      await apiClient.deleteWorkflow(id);
      toast("已删除", "success");
      loadWorkflows();
    } catch (e) {
      toast("删除失败", "error");
    }
  }, [loadWorkflows]);

  const handleExport = useCallback(async (id: string) => {
    try {
      const wf = await apiClient.getWorkflow(id);
      const blob = new Blob([JSON.stringify(wf, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${wf.name || "workflow"}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("已导出", "success");
    } catch {
      toast("导出失败", "error");
    }
  }, []);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const doc = JSON.parse(text) as WorkflowDocument;
      doc.id = "";
      doc.name = (doc.name || "导入的工作流") + " (导入)";
      const saved = await apiClient.saveWorkflow(doc);
      toast("导入成功", "success");
      loadWorkflows();
      await selectWorkflow(saved.id);
    } catch {
      toast("导入失败，请检查 JSON 格式", "error");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  }, [loadWorkflows, selectWorkflow]);

  return (
    <div className="workflow-manager h-full min-h-0 min-w-0 flex flex-col">
      <div className="manager-toolbar flex items-center gap-3 px-4 py-3 border-b">
        <div className="min-w-0 flex-1"><h2 className="whitespace-nowrap text-sm font-semibold">工作流管理</h2><p className="mt-0.5 text-[11px] text-muted">{workflows.length} 个工作流</p></div>
        <div className="flex shrink-0 items-center gap-2">
        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-border hover:bg-raised cursor-pointer transition focus-within:ring-2 focus-within:ring-primary">
          <Import size={14} />导入
          <input aria-label="导入工作流 JSON" type="file" accept=".json" onChange={handleImport} className="sr-only" disabled={importing} />
        </label>
        <button
          onClick={async () => {
            try {
              const wf: WorkflowDocument = { id: "", name: "新建工作流", version: 1, nodes: [], edges: [] };
              const saved = await apiClient.saveWorkflow(wf);
              toast("已创建", "success");
              loadWorkflows();
              await selectWorkflow(saved.id);
              onOpen?.();
            } catch { toast("创建失败", "error"); }
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-white font-medium hover:opacity-90"
        >
          <Plus size={14} />新建
        </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {workflows.length === 0 ? (
          <div className="text-center text-muted py-12">
            <FolderOpen size={32} className="mx-auto mb-3 opacity-40" />
            <div className="text-sm">暂无工作流</div>
            <div className="text-xs mt-1">点击"新建"或"导入"开始</div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3">
            {workflows.map((wf) => (
              <div
                key={wf.id}
                className="rounded-xl border border-border bg-surface p-4 hover:border-border-hover transition group"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{wf.name}</div>
                    <div className="text-[10px] text-muted mt-0.5">
                      v{wf.version ?? 1} · {RUN_STATUS_LABELS[wf.last_run_status ?? ""] ?? wf.last_run_status ?? "从未运行"}
                    </div>
                  </div>
                  {wf.active && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-medium shrink-0">
                      已发布
                    </span>
                  )}
                </div>
                <div className="flex gap-2 mt-3 pt-2 border-t border-border/30">
                  <button
                    onClick={() => handleSelect(wf.id)}
                    className="px-3 py-1 rounded text-xs bg-primary text-white hover:opacity-90 font-medium"
                  >
                    打开
                  </button>
                  <button
                    onClick={() => handleExport(wf.id)}
                    className="px-3 py-1 rounded text-xs border border-border text-muted hover:bg-raised"
                  >
                    导出
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => handleDelete(wf.id, wf.name ?? "")}
                    className="px-3 py-1 rounded text-xs text-muted hover:text-red-400 hover:bg-red-500/5"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
