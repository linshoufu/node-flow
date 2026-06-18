import type { RunEvent } from "../types";

export type TestCaseReport = {
  id: string;
  name: string;
  status: "passed" | "failed" | "unknown";
  message?: string;
  durationMs?: number;
  sourceNodeId?: string;
};

export type TestReportSummary = {
  total: number;
  passed: number;
  failed: number;
  unknown: number;
};

export type TestReport = {
  summary: TestReportSummary;
  cases: TestCaseReport[];
  hasCases: boolean;
};

const emptySummary: TestReportSummary = { total: 0, passed: 0, failed: 0, unknown: 0 };

export function buildTestReport(events: RunEvent[]): TestReport {
  const cases: TestCaseReport[] = [];
  let summaryFromEvent: TestReportSummary | undefined;

  events.forEach((event, index) => {
    if (isRecordResultEvent(event)) {
      const testCase = buildCaseReport(event, index);
      if (testCase) {
        cases.push(testCase);
      }
      return;
    }

    if (isSummaryEvent(event)) {
      summaryFromEvent = readSummary(event.payload) ?? summaryFromEvent;
    }
  });

  const summary = cases.length > 0 ? summarizeCases(cases) : summaryFromEvent ?? { ...emptySummary };

  return {
    summary,
    cases,
    hasCases: cases.length > 0,
  };
}

function buildCaseReport(event: RunEvent, index: number): TestCaseReport | undefined {
  const result = readResult(event.payload);
  const source = isRecord(result) ? result : {};
  const sourceNodeId = event.node_id ?? undefined;
  const errorMessage = readErrorMessage(event.payload.error);
  const status = readStatus(source, event.type);
  const id = readString(source.id) ?? sourceNodeId ?? `case-${index + 1}`;
  const name = readString(source.name) ?? sourceNodeId ?? "未命名用例";
  const message = readString(source.message) ?? errorMessage;
  const durationMs = readNumber(source.durationMs) ?? readNumber(source.duration_ms) ?? readNumber(event.payload.duration_ms);

  return {
    id,
    name,
    status,
    ...(message ? { message } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(sourceNodeId ? { sourceNodeId } : {}),
  };
}

function isRecordResultEvent(event: RunEvent): boolean {
  return readNodeType(event) === "test.record_result";
}

function isSummaryEvent(event: RunEvent): boolean {
  return readNodeType(event) === "test.summary";
}

function readNodeType(event: RunEvent): string | undefined {
  const payload = event.payload;
  const node = isRecord(payload.node) ? payload.node : undefined;
  return (
    readString(payload.node_type) ??
    readString(payload.nodeType) ??
    readString(payload.type) ??
    readString(node?.type) ??
    readString(node?.node_type)
  );
}

function readResult(payload: Record<string, unknown>): unknown {
  const outputs = isRecord(payload.outputs) ? payload.outputs : undefined;
  const success = isRecord(outputs?.success) ? outputs.success : undefined;

  return (
    success?.result ??
    success?.case ??
    outputs?.result ??
    outputs?.case ??
    payload.result ??
    payload.case
  );
}

function readSummary(payload: Record<string, unknown>): TestReportSummary | undefined {
  const outputs = isRecord(payload.outputs) ? payload.outputs : undefined;
  const success = isRecord(outputs?.success) ? outputs.success : undefined;
  const summary = success?.summary ?? outputs?.summary ?? payload.summary;

  if (!isRecord(summary)) {
    return undefined;
  }

  return {
    total: readNonNegativeNumber(summary.total),
    passed: readNonNegativeNumber(summary.passed),
    failed: readNonNegativeNumber(summary.failed),
    unknown: readNonNegativeNumber(summary.unknown),
  };
}

function readStatus(source: Record<string, unknown>, eventType: string): TestCaseReport["status"] {
  const status = source.status;
  if (status === "passed" || status === "failed" || status === "unknown") {
    return status;
  }

  if (typeof source.passed === "boolean") {
    return source.passed ? "passed" : "failed";
  }

  return eventType === "node_failed" ? "failed" : "unknown";
}

function summarizeCases(cases: TestCaseReport[]): TestReportSummary {
  return cases.reduce<TestReportSummary>(
    (summary, testCase) => ({
      total: summary.total + 1,
      passed: summary.passed + (testCase.status === "passed" ? 1 : 0),
      failed: summary.failed + (testCase.status === "failed" ? 1 : 0),
      unknown: summary.unknown + (testCase.status === "unknown" ? 1 : 0),
    }),
    { ...emptySummary }
  );
}

function readErrorMessage(error: unknown): string | undefined {
  if (typeof error === "string") {
    return error;
  }

  if (!isRecord(error)) {
    return undefined;
  }

  return readString(error.message);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNonNegativeNumber(value: unknown): number {
  const number = readNumber(value);
  return number !== undefined && number >= 0 ? number : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
