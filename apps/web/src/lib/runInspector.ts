import type { RunEvent, RunRecord } from "../types";
import { buildExecutionData, type ExecutionData } from "./executionData";
import { buildNodeRunDetail, type NodeRunDetail } from "./nodeRunDetail";
import { buildNodeRunStatesForNodeIds, type NodeRuntimeState } from "./runState";
import { currentRunView, emptyRunView, historicalRunView, type RunViewState } from "./runView";
import { buildTestReportFromExecutionData, type TestReport } from "./testReport";

export type RunInspectorExecutionSummary = {
  nodeCount: number;
  executionCount: number;
  eventCount: number;
  failedExecutionCount: number;
  inputItemCount: number;
  outputItemCount: number;
};

export type RunInspectorRunData = {
  executionData: ExecutionData;
  report: TestReport;
  executionSummary: RunInspectorExecutionSummary | null;
};

export type RunInspectorCanvasData = {
  nodeRunStates: Record<string, NodeRuntimeState>;
  nodeRunDetails: Record<string, NodeRunDetail>;
};

export type RunInspectorSelectionData = {
  nodeId: string | null;
  runtimeState?: NodeRuntimeState;
  runDetail: NodeRunDetail | null;
};

export type RunInspector = {
  view: RunViewState;
  runData: RunInspectorRunData;
  canvas: RunInspectorCanvasData;
  selection: RunInspectorSelectionData;
  executionData: ExecutionData;
  report: TestReport;
  executionSummary: RunInspectorExecutionSummary | null;
  selectedNodeRunDetail: NodeRunDetail | null;
  nodeRunStates: Record<string, NodeRuntimeState>;
  nodeRunDetails: Record<string, NodeRunDetail>;
  selectedRuntimeState?: NodeRuntimeState;
};

export type BuildRunInspectorInput = {
  run: RunRecord | null;
  events: RunEvent[];
  isHistoricalRun?: boolean;
  nodeIds?: string[];
  selectedNodeId?: string | null;
};

export function buildRunInspector({
  run,
  events,
  isHistoricalRun = false,
  nodeIds = [],
  selectedNodeId = null,
}: BuildRunInspectorInput): RunInspector {
  const executionData = buildExecutionData(events);
  const view = run
    ? isHistoricalRun
      ? historicalRunView(run, events)
      : currentRunView(run, events)
    : { ...emptyRunView(), events };
  const hasRuntimeData = Boolean(run || events.length > 0);
  const nodeRunStates = hasRuntimeData ? buildNodeRunStatesForNodeIds(nodeIds, events, run?.status) : {};
  const nodeRunDetails = hasRuntimeData
    ? Object.fromEntries(nodeIds.map((nodeId) => [nodeId, buildNodeRunDetail(executionData, nodeId)]))
    : {};

  const report = buildTestReportFromExecutionData(executionData);
  const executionSummary = run ? buildRunInspectorExecutionSummary(executionData, events.length) : null;
  const selectedRuntimeState = selectedNodeId ? nodeRunStates[selectedNodeId] : undefined;
  const selectedNodeRunDetail = selectedNodeId ? buildNodeRunDetail(executionData, selectedNodeId) : null;
  const runData: RunInspectorRunData = { executionData, report, executionSummary };
  const canvas: RunInspectorCanvasData = { nodeRunStates, nodeRunDetails };
  const selection: RunInspectorSelectionData = {
    nodeId: selectedNodeId,
    runtimeState: selectedRuntimeState,
    runDetail: selectedNodeRunDetail,
  };

  return {
    view,
    runData,
    canvas,
    selection,
    executionData,
    report,
    executionSummary,
    selectedNodeRunDetail,
    nodeRunStates,
    nodeRunDetails,
    selectedRuntimeState,
  };
}

function buildRunInspectorExecutionSummary(
  executionData: ExecutionData,
  eventCount: number
): RunInspectorExecutionSummary {
  const summaries = Object.values(executionData.nodeSummaries);
  const executionCount = Object.values(executionData.nodeRuns).reduce((count, runs) => count + runs.length, 0);

  return {
    nodeCount: executionData.nodeOrder.length,
    executionCount,
    eventCount,
    failedExecutionCount: summaries.reduce((count, summary) => count + summary.errorCount, 0),
    inputItemCount: summaries.reduce((count, summary) => count + summary.inputItemCount, 0),
    outputItemCount: summaries.reduce((count, summary) => count + summary.outputItemCount, 0),
  };
}
