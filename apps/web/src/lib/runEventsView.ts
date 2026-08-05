import type { RunEvent } from "../types";
import { translateEventType } from "./display";
import { formatScope } from "./runtimeDisplay";

export function filterRunEvents(
  events: RunEvent[],
  query: string,
  nodeDisplayNames: Record<string, string>
): RunEvent[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return events;
  }

  return events.filter((event) => normalize(runEventSearchText(event, nodeDisplayNames)).includes(normalizedQuery));
}

function runEventSearchText(event: RunEvent, nodeDisplayNames: Record<string, string>): string {
  return [
    event.type,
    translateEventType(event.type),
    event.node_id,
    event.node_id ? nodeDisplayNames[event.node_id] : undefined,
    event.scope.join(" / "),
    event.scope.length > 0 ? formatScope(event.scope) : undefined,
    searchPart(event.payload),
  ]
    .filter((part) => part !== undefined && part !== null)
    .join(" ");
}

function searchPart(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
