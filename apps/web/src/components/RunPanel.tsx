import type { RunEvent, RunRecord } from "../types";

type RunPanelProps = {
  run: RunRecord | null;
  events: RunEvent[];
};

export function RunPanel({ run, events }: RunPanelProps) {
  return (
    <section className="run-panel" aria-label="Run log">
      <div className="panel-heading">
        <h2>Run Log</h2>
        <span className={run ? `status-pill status-${run.status}` : "status-pill"}>{run?.status ?? "idle"}</span>
      </div>
      {events.length === 0 ? (
        <p className="empty-state">No run events yet.</p>
      ) : (
        <div className="run-events">
          {events.map((event, index) => (
            <div className="run-event" key={event.id ?? `${event.run_id}-${index}`}>
              <time>{formatTime(event.timestamp)}</time>
              <strong>{event.type}</strong>
              <span>{event.node_id ?? "workflow"}</span>
              <code>{JSON.stringify(event.payload)}</code>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
}
