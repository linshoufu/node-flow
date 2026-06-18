import type { RunEvent, RunRecord } from "../types";
import { translateEventType, translateRunStatus } from "../lib/display";

type RunPanelProps = {
  run: RunRecord | null;
  events: RunEvent[];
  onSelectNode?: (nodeId: string) => void;
};

export function RunPanel({ run, events, onSelectNode }: RunPanelProps) {
  return (
    <section className="run-panel" aria-label="运行日志">
      <div className="panel-heading">
        <div>
          <h2>运行日志</h2>
          <p>查看节点执行顺序和输出</p>
        </div>
        <span className={run ? `status-pill status-${run.status}` : "status-pill"}>
          {translateRunStatus(run?.status ?? "idle")}
        </span>
      </div>
      {events.length === 0 ? (
        <p className="empty-state">还没有运行事件。</p>
      ) : (
        <div className="run-events">
          {events.map((event, index) => (
            <RunEventRow
              event={event}
              key={event.id ?? `${event.run_id}-${index}`}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      )}
    </section>
  );
}

type RunEventRowProps = {
  event: RunEvent;
  onSelectNode?: (nodeId: string) => void;
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
        onClick={() => onSelectNode(event.node_id as string)}
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
