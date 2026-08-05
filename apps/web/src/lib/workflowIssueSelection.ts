import type { EditScope } from "./workflow";
import type { WorkflowIssueItem } from "./workflowIssues";
import { isIssuePathInCurrentEditScope } from "./workflowIssueScopes";

export type WorkflowIssueSelection =
  | { kind: "node"; nodeId: string; field?: string }
  | { kind: "settings"; field?: string }
  | { kind: "edge"; edgeId: string }
  | { kind: "message"; message: string; resetEdgeFocus: boolean };

export type WorkflowIssueSelectionOptions = {
  editScope: EditScope;
  editableNodeIds: ReadonlySet<string>;
  editableEdgeIds: ReadonlySet<string>;
};

/**
 * 决定点击一个工作流问题后应执行的动作（纯决策，不触碰任何状态）。
 * 子流程作用域规则：pre_run 问题只允许定位到当前打开的编辑作用域；
 * validation 问题不做作用域限制，仅要求目标仍在可编辑文档中。
 */
export function resolveWorkflowIssueSelection(
  issue: WorkflowIssueItem,
  { editScope, editableNodeIds, editableEdgeIds }: WorkflowIssueSelectionOptions
): WorkflowIssueSelection {
  const target = issue.target;

  if (target.kind === "node") {
    const isInCurrentScope =
      issue.source === "pre_run" ? isIssuePathInCurrentEditScope(target.path, editScope) : true;
    if (isInCurrentScope && editableNodeIds.has(target.nodeId)) {
      return { kind: "node", nodeId: target.nodeId, field: target.field };
    }

    return {
      kind: "message",
      message:
        issue.source === "pre_run"
          ? "这个运行前问题属于未打开的子流程，请先进入对应循环体查看。"
          : "这个验证问题属于未打开的子流程，请先进入对应循环体查看。",
      resetEdgeFocus: false,
    };
  }

  if (target.kind === "settings") {
    return { kind: "settings", field: target.field };
  }

  if (target.kind === "edge") {
    const isInCurrentScope =
      issue.source === "pre_run" ? isIssuePathInCurrentEditScope(target.path, editScope) : true;
    if (isInCurrentScope && editableEdgeIds.has(target.edgeId)) {
      return { kind: "edge", edgeId: target.edgeId };
    }

    return {
      kind: "message",
      message:
        issue.source === "pre_run"
          ? "这个运行前连线问题属于未打开的子流程，请先进入对应循环体查看。"
          : "这个验证连线问题属于未打开的子流程，请先进入对应循环体查看。",
      resetEdgeFocus: false,
    };
  }

  return {
    kind: "message",
    message: "请根据提示检查对应连线或工作流配置。",
    resetEdgeFocus: true,
  };
}
