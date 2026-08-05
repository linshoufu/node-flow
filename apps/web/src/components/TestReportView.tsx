import { useMemo, useState } from "react";
import type { RunEvent } from "../types";
import { buildNodeRuntimeTarget, type NodeRuntimeNavigationTarget } from "../lib/nodeRuntimeNavigation";
import { buildTestReport, type TestCaseReport, type TestReport } from "../lib/testReport";

type TestReportViewProps = {
  events?: RunEvent[];
  report?: TestReport;
  onSelectNode?: (target: NodeRuntimeNavigationTarget) => void;
};

const STATUS_LABELS: Record<TestCaseReport["status"], string> = {
  passed: "通过",
  failed: "失败",
  unknown: "未知",
};

type StatusFilter = "all" | TestCaseReport["status"];

const SOURCE_PREFIX = "\u6765\u6e90\uff1a";
const EMPTY_MATCH_TEXT = "\u6ca1\u6709\u5339\u914d\u7684\u7528\u4f8b";

const FILTERS: Array<{ label: string; value: StatusFilter }> = [
  { label: "\u5168\u90e8", value: "all" },
  { label: "\u5931\u8d25", value: "failed" },
  { label: "\u672a\u77e5", value: "unknown" },
  { label: "\u901a\u8fc7", value: "passed" },
];

export function TestReportView({ events, report, onSelectNode }: TestReportViewProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const resolvedReport = report ?? buildTestReport(events ?? []);
  const hasSummaryData = resolvedReport.summary.total > 0;
  const filteredCases = useMemo(
    () =>
      statusFilter === "all"
        ? resolvedReport.cases
        : resolvedReport.cases.filter((testCase) => testCase.status === statusFilter),
    [resolvedReport.cases, statusFilter]
  );

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
        <div className="test-report-filters" aria-label="测试用例状态筛选">
          {FILTERS.map((filter) => (
            <button
              aria-pressed={statusFilter === filter.value}
              key={filter.value}
              type="button"
              onClick={() => setStatusFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      ) : null}

      {resolvedReport.cases.length > 0 ? (
        filteredCases.length > 0 ? (
          <div className="test-case-list" aria-label="测试用例明细">
            {filteredCases.map((testCase, index) => (
              <TestCaseRow key={`${testCase.id}-${index}`} testCase={testCase} onSelectNode={onSelectNode} />
            ))}
          </div>
        ) : (
          <p className="empty-state">{EMPTY_MATCH_TEXT}</p>
        )
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
  onSelectNode?: (target: NodeRuntimeNavigationTarget) => void;
};

function TestCaseRow({ testCase, onSelectNode }: TestCaseRowProps) {
  const content = (
    <>
      <div className="test-case-main">
        <strong>{testCase.name}</strong>
        {testCase.message ? <p>{testCase.message}</p> : null}
        {testCase.sourceNodeId ? (
          <span className="test-case-source">
            {SOURCE_PREFIX}
            {testCase.sourceNodeId}
          </span>
        ) : null}
      </div>
      {testCase.durationMs !== undefined ? <span className="test-case-duration">{formatDuration(testCase.durationMs)}</span> : null}
      <span className={`test-case-status status-${testCase.status}`}>{STATUS_LABELS[testCase.status]}</span>
    </>
  );

  if (testCase.sourceNodeId && onSelectNode) {
    return (
      <button
        aria-label={`${testCase.name} ${SOURCE_PREFIX}${testCase.sourceNodeId}`}
        className="test-case-row test-case-button"
        type="button"
        onClick={() => onSelectNode(buildNodeRuntimeTarget(testCase.sourceNodeId as string, "test_report", testCase.sourceScope))}
      >
        {content}
      </button>
    );
  }

  return <article className="test-case-row">{content}</article>;
}

function formatDuration(durationMs: number): string {
  return `${durationMs} ms`;
}
