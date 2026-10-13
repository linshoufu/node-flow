import type { RunEvent } from "@/types";

export type RunResult = {
  name: string;
  status: "passed" | "failed";
  index: number | null;
  row: Record<string, unknown> | null;
  statusCode: number | null;
  message: string;
  raw: Record<string, unknown>;
  event: RunEvent | null;
  responseEvent: RunEvent | null;
};
export type RunReport = { results: RunResult[]; total: number; passed: number; failed: number; complete: boolean };

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function parseBody(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}
export function responseData(event: RunEvent) {
  const outputs = record(event.payload.outputs);
  return [outputs?.success, outputs?.error].map(record).find((value) => typeof value?.status_code === "number") ?? null;
}
function isResult(value: unknown): value is Record<string, unknown> {
  const item = record(value);
  return typeof item?.name === "string" && ["passed", "failed"].includes(String(item.status));
}
function resultKey(value: Record<string, unknown>): string {
  return JSON.stringify([value.name, value.status, value.assertion, value.index, value.row, value.actual, value.message]);
}
export function resultMessage(result: Record<string, unknown>): string {
  const actual = record(result.actual);
  const body = record(parseBody(actual?.body));
  if (typeof body?.detail === "string") return body.detail;
  if (Array.isArray(body?.detail)) {
    return body.detail.map((value) => {
      const detail = record(value);
      if (!detail) return String(value);
      const field = Array.isArray(detail.loc) ? detail.loc.filter((part) => part !== "body").join(".") : "";
      const context = record(detail.ctx);
      const message = detail.type === "greater_than_equal" && context?.ge !== undefined ? `需大于或等于 ${context.ge}` : detail.msg;
      return `${field ? `${field}：` : ""}${message ?? "参数校验失败"}`;
    }).join("；");
  }
  if (result.assertion === "status_code" && result.actual !== undefined) {
    return result.status === "passed" ? `状态码符合预期（${result.actual}）` : `预期状态码 ${result.expected}，实际 ${result.actual}`;
  }
  return typeof result.message === "string" && result.message ? result.message : result.status === "passed" ? "检查通过" : "检查未通过";
}

/** Prefer the final root report; record events provide progress and links to each row's response. */
export function collectRunReport(events: RunEvent[], nodeTypes: Record<string, string> = {}): RunReport | null {
  const records: Array<{ event: RunEvent; value: Record<string, unknown>; responseEvent: RunEvent | null }> = [];
  const responses = new Map<string, RunEvent>();
  for (const event of events) {
    if (!["node_succeeded", "node_error_handled"].includes(event.type)) continue;
    const scope = JSON.stringify(event.scope);
    if (responseData(event)) responses.set(scope, event);
    const value = record(event.payload.outputs)?.success;
    const type = nodeTypes[event.node_id ?? ""];
    if (isResult(value) && (!type || type === "test.record_result")) records.push({ event, value, responseEvent: responses.get(scope) ?? null });
  }
  let finalValues: unknown[] | null = null;
  let reportEvent: RunEvent | null = null;
  for (const event of [...events].reverse()) {
    if (event.scope.length || !["node_succeeded", "node_error_handled"].includes(event.type)) continue;
    const type = nodeTypes[event.node_id ?? ""];
    if (type && !["test.summary", "test.write_report"].includes(type)) continue;
    const output = record(record(event.payload.outputs)?.success);
    const report = record(output?.report) ?? output;
    if (record(report?.summary) && Array.isArray(report?.results)) { finalValues = report.results; reportEvent = event; break; }
  }
  if (!finalValues && !records.length) return null;
  const candidates = new Map<string, { entries: typeof records; cursor: number }>();
  for (const source of records) {
    const key = resultKey(source.value);
    const group = candidates.get(key) ?? { entries: [], cursor: 0 };
    group.entries.push(source);
    candidates.set(key, group);
  }
  const results = (finalValues ?? records.map((item) => item.value)).filter(isResult).map((raw): RunResult => {
    const group = candidates.get(resultKey(raw));
    const source = group ? group.entries[group.cursor++] : null;
    const responseEvent = source?.responseEvent ?? null;
    const actual = record(raw.actual);
    const code = actual?.status_code ?? (raw.assertion === "status_code" ? raw.actual : responseEvent ? responseData(responseEvent)?.status_code : null);
    return {
      name: String(raw.name), status: raw.status as RunResult["status"],
      index: typeof raw.index === "number" ? raw.index : null,
      row: record(raw.row), statusCode: typeof code === "number" ? code : null,
      message: resultMessage(raw), raw, event: source?.event ?? reportEvent, responseEvent,
    };
  });
  const passed = results.filter((result) => result.status === "passed").length;
  return { results, total: results.length, passed, failed: results.length - passed, complete: finalValues !== null };
}
