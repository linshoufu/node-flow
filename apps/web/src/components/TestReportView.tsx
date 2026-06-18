import type { RunEvent } from "../types";
import { buildTestReport, type TestCaseReport, type TestReport } from "../lib/testReport";

type TestReportViewProps = {
  events?: RunEvent[];
  report?: TestReport;
};

const STATUS_LABELS: Record<TestCaseReport["status"], string> = {
  passed: "通过",
  failed: "失败",
  unknown: "未知",
};

export function TestReportView({ events, report }: TestReportViewProps) {
  const resolvedReport = report ?? buildTestReport(events ?? []);
  const hasSummaryData = resolvedReport.summary.total > 0;

  if (!hasSummaryData && !resolvedReport.hasCases) {
    return <p className="empty-state">暂无测试报告</p>;
  }

  return (
    <div className="test-report-view">
      <div className="test-report-summary" aria-label="测试报告摘要">
        <SummaryItem label="总数" value={resolvedReport.summary.total} tone="total" />
        <SummaryItem label="通过" value={resolvedReport.summary.passed} tone="passed" />
        <SummaryItem label="失败" value={resolvedReport.summary.failed} tone="failed" />
        <SummaryItem label="未知" value={resolvedReport.summary.unknown} tone="unknown" />
      </div>

      {resolvedReport.cases.length > 0 ? (
        <div className="test-case-list" aria-label="测试用例明细">
          {resolvedReport.cases.map((testCase) => (
            <TestCaseRow key={testCase.id} testCase={testCase} />
          ))}
        </div>
      ) : (
        <p className="empty-state">暂无明细</p>
      )}
    </div>
  );
}

type SummaryItemProps = {
  label: string;
  value: number;
  tone: "total" | TestCaseReport["status"];
};

function SummaryItem({ label, value, tone }: SummaryItemProps) {
  return (
    <div className={`test-report-summary-item summary-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type TestCaseRowProps = {
  testCase: TestCaseReport;
};

function TestCaseRow({ testCase }: TestCaseRowProps) {
  return (
    <article className="test-case-row">
      <div className="test-case-main">
        <strong>{testCase.name}</strong>
        {testCase.message ? <p>{testCase.message}</p> : null}
      </div>
      {testCase.durationMs !== undefined ? <span className="test-case-duration">{formatDuration(testCase.durationMs)}</span> : null}
      <span className={`test-case-status status-${testCase.status}`}>{STATUS_LABELS[testCase.status]}</span>
    </article>
  );
}

function formatDuration(durationMs: number): string {
  return `${durationMs} ms`;
}
