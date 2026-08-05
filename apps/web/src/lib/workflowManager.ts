import type { RunRecord, RunStatus, WorkflowSummary } from "../types";

export type WorkflowStatusKind = RunStatus | "idle";
export type WorkflowManagerStatusFilter = "all" | "succeeded" | "failed" | "cancelled" | "running" | "not_run";
export type WorkflowManagerSortMode = "updated_desc" | "name_asc" | "node_count_desc";

export type WorkflowManagerOptions = {
  status?: WorkflowManagerStatusFilter;
  sort?: WorkflowManagerSortMode;
};

export type WorkflowManagerItem = {
  workflow: WorkflowSummary;
  isActive: boolean;
  title: string;
  subtitle: string;
  metadata: string;
  statusLabel: string;
  statusKind: WorkflowStatusKind;
};

const UNNAMED_WORKFLOW_LABEL = "未命名工作流";

export function buildWorkflowManagerItems(
  workflows: WorkflowSummary[],
  selectedWorkflowId: string,
  query: string,
  options: WorkflowManagerOptions = {}
): WorkflowManagerItem[] {
  const normalizedQuery = normalizeSearchText(query);
  const statusFilter = options.status ?? "all";
  const sortMode = options.sort ?? "updated_desc";

  return workflows
    .map((workflow) => {
      const title = workflowDisplayName(workflow.name);
      const statusKind: WorkflowStatusKind = workflow.last_run_status ?? "idle";
      return {
        workflow,
        isActive: workflow.id === selectedWorkflowId,
        title,
        subtitle: `v${workflow.version}`,
        metadata: workflowMetadata(workflow),
        statusLabel: workflowStatusLabel(workflow.last_run_status),
        statusKind,
      };
    })
    .filter((item) => workflowMatchesStatus(item.workflow, statusFilter))
    .filter((item) => {
      if (!normalizedQuery) {
        return true;
      }

      return normalizeSearchText(
        `${item.title} ${item.workflow.id} ${item.workflow.description ?? ""} ${(item.workflow.tags ?? []).join(" ")}`
      ).includes(normalizedQuery);
    })
    .sort((left, right) => compareWorkflowItems(left, right, sortMode));
}

export function workflowStatusFilterCounts(workflows: WorkflowSummary[]) {
  return {
    all: workflows.length,
    succeeded: workflows.filter((workflow) => workflow.last_run_status === "succeeded").length,
    failed: workflows.filter((workflow) => workflow.last_run_status === "failed").length,
    cancelled: workflows.filter((workflow) => workflow.last_run_status === "cancelled").length,
    running: workflows.filter((workflow) => workflow.last_run_status === "running" || workflow.last_run_status === "queued").length,
    not_run: workflows.filter((workflow) => !workflow.last_run_status).length,
  };
}

export function sortWorkflowRunsByRecent(runs: RunRecord[]): RunRecord[] {
  return [...runs].sort((left, right) => {
    const timestampDifference = timestampOf(right.created_at) - timestampOf(left.created_at);
    if (timestampDifference !== 0) {
      return timestampDifference;
    }
    return right.id.localeCompare(left.id);
  });
}

export function mergeWorkflowRunHistory(currentRuns: RunRecord[], nextPage: RunRecord[]): RunRecord[] {
  const runsById = new Map(currentRuns.map((run) => [run.id, run]));
  for (const run of nextPage) {
    runsById.set(run.id, run);
  }
  return sortWorkflowRunsByRecent([...runsById.values()]);
}

function workflowMatchesStatus(workflow: WorkflowSummary, statusFilter: WorkflowManagerStatusFilter): boolean {
  switch (statusFilter) {
    case "succeeded":
      return workflow.last_run_status === "succeeded";
    case "failed":
      return workflow.last_run_status === "failed";
    case "cancelled":
      return workflow.last_run_status === "cancelled";
    case "running":
      return workflow.last_run_status === "running" || workflow.last_run_status === "queued";
    case "not_run":
      return !workflow.last_run_status;
    default:
      return true;
  }
}

function compareWorkflowItems(left: WorkflowManagerItem, right: WorkflowManagerItem, sortMode: WorkflowManagerSortMode): number {
  switch (sortMode) {
    case "name_asc":
      return left.title.localeCompare(right.title, "zh-Hans") || left.workflow.id.localeCompare(right.workflow.id);
    case "node_count_desc":
      return (right.workflow.node_count ?? 0) - (left.workflow.node_count ?? 0) || compareUpdatedAtDesc(left, right);
    default:
      return compareUpdatedAtDesc(left, right);
  }
}

function compareUpdatedAtDesc(left: WorkflowManagerItem, right: WorkflowManagerItem): number {
  return timestampOf(right.workflow.updated_at) - timestampOf(left.workflow.updated_at) || left.title.localeCompare(right.title, "zh-Hans");
}

function timestampOf(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function workflowDisplayName(name: string): string {
  return name.trim() || UNNAMED_WORKFLOW_LABEL;
}

function workflowMetadata(workflow: WorkflowSummary): string {
  const nodeCount = workflow.node_count ?? 0;
  return `${nodeCount} 个节点 · ${formatWorkflowUpdatedAt(workflow.updated_at)}`;
}

function formatWorkflowUpdatedAt(value: string | null | undefined): string {
  if (!value) {
    return "未知时间";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未知时间";
  }

  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("/") +
    " " +
    [date.getUTCHours().toString().padStart(2, "0"), date.getUTCMinutes().toString().padStart(2, "0")].join(":");
}

function workflowStatusLabel(status: RunStatus | null | undefined): string {
  switch (status) {
    case "queued":
      return "最近排队";
    case "running":
      return "最近运行中";
    case "succeeded":
      return "最近成功";
    case "failed":
      return "最近失败";
    case "cancelled":
      return "最近取消";
    default:
      return "未运行";
  }
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}
