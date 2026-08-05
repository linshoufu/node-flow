import type { WorkflowEdge, WorkflowNode } from "../types";
import type { NodeRuntimeNavigationTarget } from "./nodeRuntimeNavigation";
import type { EditScope } from "./workflow";
import type { WorkflowIssueItem } from "./workflowIssues";

export function isIssuePathInCurrentEditScope(path: string[] | undefined, editScope: EditScope): boolean {
  const issueScope = editScopeFromIssuePath(path);
  const currentScope = editScope ?? [];

  return areEditScopesEqual(issueScope, currentScope);
}

export function buildNodeIssuesByNodeId(
  issues: WorkflowIssueItem[],
  editableNodes: WorkflowNode[],
  editScope: EditScope
): Record<string, WorkflowIssueItem[]> {
  const editableNodeIds = new Set(editableNodes.map((node) => node.id));
  const issuesByNodeId: Record<string, WorkflowIssueItem[]> = {};

  for (const issue of issues) {
    if (issue.target.kind !== "node" || !editableNodeIds.has(issue.target.nodeId)) {
      continue;
    }

    const isInCurrentScope =
      issue.source === "pre_run" ? isIssuePathInCurrentEditScope(issue.target.path, editScope) : true;
    if (!isInCurrentScope) {
      continue;
    }

    issuesByNodeId[issue.target.nodeId] = [...(issuesByNodeId[issue.target.nodeId] ?? []), issue];
  }

  return issuesByNodeId;
}

export function buildEdgeIssuesByEdgeId(
  issues: WorkflowIssueItem[],
  editableEdges: WorkflowEdge[],
  editScope: EditScope
): Record<string, WorkflowIssueItem[]> {
  const editableEdgeIds = new Set(editableEdges.map((edge) => edge.id));
  const issuesByEdgeId: Record<string, WorkflowIssueItem[]> = {};

  for (const issue of issues) {
    if (issue.target.kind !== "edge" || !editableEdgeIds.has(issue.target.edgeId)) {
      continue;
    }

    const isInCurrentScope =
      issue.source === "pre_run" ? isIssuePathInCurrentEditScope(issue.target.path, editScope) : true;
    if (!isInCurrentScope) {
      continue;
    }

    issuesByEdgeId[issue.target.edgeId] = [...(issuesByEdgeId[issue.target.edgeId] ?? []), issue];
  }

  return issuesByEdgeId;
}

export function isRunSelectionInCurrentEditScope(target: NodeRuntimeNavigationTarget, editScope: EditScope): boolean {
  const targetScope = editScopeFromRunEventScope(target.scope);
  const currentScope = editScope ?? [];

  return areEditScopesEqual(targetScope, currentScope);
}

export function areEditScopesEqual(left: NonNullable<EditScope>, right: NonNullable<EditScope>): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (step, index) => step.nodeId === right[index].nodeId && step.subflowName === right[index].subflowName
  );
}

export function editScopeFromIssuePath(path: string[] | undefined): NonNullable<EditScope> {
  if (!path || path[0] !== "root") {
    return [];
  }

  const scope: NonNullable<EditScope> = [];
  for (let index = 1; index < path.length - 1; index += 2) {
    const nodeId = path[index];
    const subflowName = path[index + 1];
    if (!nodeId || !subflowName) {
      break;
    }
    scope.push({ nodeId, subflowName });
  }

  return scope;
}

export function editScopeFromRunEventScope(scope: string[] | undefined): NonNullable<EditScope> {
  return (scope ?? [])
    .filter((part) => !part.startsWith("iteration:"))
    .map((nodeId) => ({
      nodeId,
      subflowName: "body",
    }));
}
