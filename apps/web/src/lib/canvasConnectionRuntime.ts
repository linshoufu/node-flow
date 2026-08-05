import type { NodeRunDetail } from "./nodeRunDetail";
import type { NodeRunStatus } from "./runState";
import type { WorkflowEdge } from "../types";

export type CanvasConnectionRuntime = {
  className: string;
  data: {
    itemCount: number;
    status: NodeRunStatus;
  };
  label: string;
};

export function buildCanvasConnectionRuntime(
  edge: WorkflowEdge,
  nodeRunDetails: Record<string, NodeRunDetail>
): CanvasConnectionRuntime | null {
  const sourceDetail = nodeRunDetails[edge.source];
  const sourceOutput = sourceDetail?.latestExecution?.outputs[edge.sourceHandle];
  const itemCount = sourceOutput?.items.length ?? 0;

  if (itemCount === 0) {
    return null;
  }

  const status = sourceDetail.latestExecution?.status ?? sourceDetail.status;

  return {
    className: `has-run-data run-${status}`,
    data: {
      itemCount,
      status,
    },
    label: `${itemCount} 项数据`,
  };
}
