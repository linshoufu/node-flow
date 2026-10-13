import { useState } from "react";
import { useWorkflowStore } from "@/store/workflow";
import { toast } from "./Toaster";

export function WorkflowTopbar() {
  const [wfName, setWfName] = useState("接口回归测试");
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const isSaving = useWorkflowStore((s) => s.isSaving);
  const saveWorkflow = useWorkflowStore((s) => s.saveWorkflow);
  const runWorkflow = useWorkflowStore((s) => s.runWorkflow);
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);

  return (
    <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b bg-surface">
      <div className="flex items-center gap-2 font-bold text-sm text-white select-none">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center text-white text-[10px] font-bold">
          NF
        </div>
        <span>节点流</span>
      </div>
      <div className="w-px h-5 bg-border" />
      <input
        value={wfName}
        onChange={(e) => {
          const v = e.target.value;
          setWfName(v);
          setWorkflowName(v);
        }}
        className="bg-transparent text-sm font-medium px-2 py-1 rounded hover:bg-raised focus:outline-none focus:ring-1 focus:ring-primary/40 w-52"
      />
      <span className="text-xs text-muted flex items-center gap-1">
        <span className={`w-2 h-2 rounded-full ${isDirty ? "bg-warning" : "bg-success"}`} />
        {isDirty ? "未保存" : "已保存"}
      </span>
      {isSaving && <span className="text-xs text-muted">保存中…</span>}
      <div className="flex-1" />
      <button
        onClick={() => { saveWorkflow(); toast("已保存", "success"); }}
        disabled={!isDirty || isSaving}
        className="px-3 h-7 rounded text-xs hover:bg-raised transition disabled:opacity-40"
      >
        💾 保存
      </button>
      <button
        onClick={() => { runWorkflow(); toast("运行中…"); }}
        className="px-4 h-7 rounded bg-primary text-white text-xs font-semibold hover:opacity-90"
      >
        ▶ 运行
      </button>
    </header>
  );
}
