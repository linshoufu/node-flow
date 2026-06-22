import { useEffect, useMemo, useState } from "react";
import type { RunEvent, RunRecord } from "../types";
import { translateEventType, translateRunStatus } from "../lib/display";
import { buildTestReport } from "../lib/testReport";
import { TestReportView } from "./TestReportView";

export type NodeSelectionTarget = {
  nodeId: string;
  scope?: string[];
};

type RunPanelProps = {
  run: RunRecord | null;
  events: RunEvent[];
  onSelectNode?: (target: NodeSelectionTarget) => void;
};

type RunPanelTab = "report" | "events";

export function RunPanel({ run, events, onSelectNode }: RunPanelProps) {
  const [activeTab, setActiveTab] = useState<RunPanelTab>("report");
  const report = useMemo(() => buildTestReport(events), [events]);
  const activeTabId = activeTab === "report" ? "run-panel-report-tab" : "run-panel-events-tab";
  const activePanelId = activeTab === "report" ? "run-panel-report-panel" : "run-panel-events-panel";

  useEffect(() => {
    setActiveTab("report");
  }, [run?.id]);

  return (
    <section className="run-panel" aria-label="运行结果">
      <div className="panel-heading">
        <div>
          <h2>运行结果</h2>
          <p>{run ? `Run ID：${run.id}` : "查看测试报告和原始运行事件"}</p>
        </div>
        <span className={run ? `status-pill status-${run.status}` : "status-pill"}>
          {translateRunStatus(run?.status ?? "idle")}
        </span>
      </div>

      <div className="run-panel-tabs" role="tablist" aria-label="运行面板视图">
        <button
          aria-controls="run-panel-report-panel"
          aria-selected={activeTab === "report"}
          id="run-panel-report-tab"
          role="tab"
          type="button"
          onClick={() => setActiveTab("report")}
        >
          测试报告
        </button>
        <button
          aria-controls="run-panel-events-panel"
          aria-selected={activeTab === "events"}
          id="run-panel-events-tab"
          role="tab"
          type="button"
          onClick={() => setActiveTab("events")}
        >
          运行事件
        </button>
      </div>

      <div aria-labelledby={activeTabId} className="run-panel-content" id={activePanelId} role="tabpanel">
        {activeTab === "report" ? (
          <TestReportView key={run?.id ?? "idle"} report={report} onSelectNode={onSelectNode} />
        ) : (
          <RunEventList events={events} onSelectNode={onSelectNode} />
        )}
      </div>
    </section>
  );
}

type RunEventListProps = {
  events: RunEvent[];
  onSelectNode?: (target: NodeSelectionTarget) => void;
};

function RunEventList({ events, onSelectNode }: RunEventListProps) {
  if (events.length === 0) {
    return <p className="empty-state">还没有运行事件。</p>;
  }

  return (
    <div className="run-events">
      {events.map((event, index) => (
        <RunEventRow event={event} key={event.id ?? `${event.run_id}-${index}`} onSelectNode={onSelectNode} />
      ))}
    </div>
  );
}

type RunEventRowProps = {
  event: RunEvent;
  onSelectNode?: (target: NodeSelectionTarget) => void;
};

function RunEventRow({ event, onSelectNode }: RunEventRowProps) {
  const eventLabel = translateEventType(event.type);
  const nodeLabel = event.node_id ?? "工作流";
  const content = (
    <>
      <time>{formatTime(event.timestamp)}</time>
      <strong>{eventLabel}</strong>
      <span>{nodeLabel}</span>
      {event.scope.length > 0 ? <em>{event.scope.join(" / ")}</em> : null}
      <code>{JSON.stringify(event.payload)}</code>
    </>
  );

  if (event.node_id && onSelectNode) {
    return (
      <button
        aria-label={`${eventLabel} ${nodeLabel}`}
        className="run-event run-event-button"
        type="button"
        onClick={() => onSelectNode({ nodeId: event.node_id as string, scope: event.scope })}
      >
        {content}
      </button>
    );
  }

  return <div className="run-event">{content}</div>;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
}
