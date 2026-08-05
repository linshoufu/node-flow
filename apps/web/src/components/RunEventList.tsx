import { useMemo, useState } from "react";
import type { RunEvent } from "../types";
import { translateEventType } from "../lib/display";
import { buildNodeRuntimeTarget } from "../lib/nodeRuntimeNavigation";
import { filterRunEvents } from "../lib/runEventsView";
import { formatScope } from "../lib/runtimeDisplay";
import { formatTime, nodeDisplayName, type NodeSelectionTarget } from "./runPanelShared";

export type RunEventListProps = {
  events: RunEvent[];
  nodeDisplayNames: Record<string, string>;
  onOpenChildRun?: (runId: string) => void;
  onSelectNode?: (target: NodeSelectionTarget) => void;
};

export function RunEventList({ events, nodeDisplayNames, onOpenChildRun, onSelectNode }: RunEventListProps) {
  const [query, setQuery] = useState("");
  const filteredEvents = useMemo(() => filterRunEvents(events, query, nodeDisplayNames), [events, nodeDisplayNames, query]);

  if (events.length === 0) {
    return <p className="empty-state">还没有运行事件。</p>;
  }

  return (
    <div className="run-events">
      <label className="run-event-search">
        <span>搜索运行事件</span>
        <input
          aria-label="搜索运行事件"
          placeholder="节点、事件类型、作用域或数据"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {filteredEvents.length === 0 ? <p className="empty-state">没有匹配的运行事件</p> : null}

      {filteredEvents.map((event, index) => (
        <RunEventRow
          event={event}
          key={event.id ?? `${event.run_id}-${index}`}
          nodeDisplayNames={nodeDisplayNames}
          onOpenChildRun={onOpenChildRun}
          onSelectNode={onSelectNode}
        />
      ))}
    </div>
  );
}

type RunEventRowProps = {
  event: RunEvent;
  nodeDisplayNames: Record<string, string>;
  onOpenChildRun?: (runId: string) => void;
  onSelectNode?: (target: NodeSelectionTarget) => void;
};

function RunEventRow({ event, nodeDisplayNames, onOpenChildRun, onSelectNode }: RunEventRowProps) {
  const eventLabel = translateEventType(event.type);
  const nodeLabel = event.node_id ? nodeDisplayName(event.node_id, nodeDisplayNames) : "工作流";
  const content = (
    <>
      <time>{formatTime(event.timestamp)}</time>
      <strong>{eventLabel}</strong>
      <span>{nodeLabel}</span>
      {event.scope.length > 0 ? <em>{formatScope(event.scope)}</em> : null}
      <code>{JSON.stringify(event.payload)}</code>
    </>
  );
  const childRunId = typeof event.payload.child_run_id === "string" ? event.payload.child_run_id : null;
  const errorRunId = typeof event.payload.error_run_id === "string" ? event.payload.error_run_id : null;
  const retryRunId = typeof event.payload.retry_run_id === "string" ? event.payload.retry_run_id : null;
  const sourceRunId = typeof event.payload.source_run_id === "string" ? event.payload.source_run_id : null;
  const linkedRunId = childRunId ?? errorRunId ?? retryRunId ?? sourceRunId;
  const linkedRunLabel = errorRunId
    ? "查看错误处理运行"
    : retryRunId
      ? "查看重试运行"
      : sourceRunId
        ? "查看原运行"
        : "查看子运行";

  if (linkedRunId && onOpenChildRun) {
    return (
      <div className="run-event run-event-child-link">
        {content}
        <button type="button" onClick={() => onOpenChildRun(linkedRunId)}>
          {linkedRunLabel}
        </button>
      </div>
    );
  }

  if (event.node_id && onSelectNode) {
    return (
      <button
        aria-label={`${eventLabel} ${nodeLabel}`}
        className="run-event run-event-button"
        type="button"
        onClick={() => onSelectNode(buildNodeRuntimeTarget(event.node_id as string, "run_event", event.scope))}
      >
        {content}
      </button>
    );
  }

  return <div className="run-event">{content}</div>;
}
